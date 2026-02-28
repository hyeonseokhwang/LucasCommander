/**
 * Telegram 알림 서비스
 * - 에스컬레이션 알림, 서비스 다운 즉시 알림, 일일 요약
 * - 양방향 명령: /status, /workers, /approve, /deny, /tasks
 */

import TelegramBot from 'node-telegram-bot-api';
import { systemMonitor } from './system-monitor.js';
import { approvalQueue } from './approval-queue.js';
import { nightCommander } from './night-commander.js';
import { ptyManager } from './pty-manager.js';
import { getPendingTasks } from '../routes/tasks.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private enabled = false;

  /** 초기화. 토큰 미설정 시 graceful skip */
  init(): void {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('[Telegram] BOT_TOKEN or CHAT_ID not set — skipping Telegram integration');
      return;
    }

    try {
      this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
      this.enabled = true;
      this.registerCommands();
      console.log('[Telegram] Bot initialized and listening for commands');
    } catch (err: any) {
      console.error('[Telegram] Failed to initialize:', err.message);
    }
  }

  /** 일반 메시지 전송 */
  async sendMessage(text: string): Promise<void> {
    if (!this.enabled || !this.bot) return;
    try {
      await this.bot.sendMessage(TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('[Telegram] sendMessage failed:', err.message);
    }
  }

  /** Tier 3 에스컬레이션 알림 */
  async sendEscalation(report: string, tier: string): Promise<void> {
    if (!this.enabled || !this.bot) return;
    const msg = [
      `🚨 *에스컬레이션 알림* (${tier})`,
      '',
      report.length > 500 ? report.slice(0, 500) + '...' : report,
      '',
      '_Commander 확인 필요_',
    ].join('\n');
    try {
      await this.bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('[Telegram] sendEscalation failed:', err.message);
    }
  }

  /** 일일/주기적 요약 */
  async sendDigest(summary: string): Promise<void> {
    if (!this.enabled || !this.bot) return;
    const msg = `📋 *Night Commander Digest*\n\n${summary.length > 3000 ? summary.slice(0, 3000) + '...' : summary}`;
    try {
      await this.bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('[Telegram] sendDigest failed:', err.message);
    }
  }

  /** 서비스 다운 즉시 알림 */
  async sendServiceAlert(service: string, status: 'down' | 'recovered'): Promise<void> {
    if (!this.enabled || !this.bot) return;
    const icon = status === 'down' ? '🔴' : '🟢';
    const msg = `${icon} *서비스 ${status === 'down' ? 'DOWN' : 'RECOVERED'}*: ${service}`;
    try {
      await this.bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('[Telegram] sendServiceAlert failed:', err.message);
    }
  }

  /** 양방향 명령 등록 */
  private registerCommands(): void {
    if (!this.bot) return;

    // /status — 전체 시스템 상태
    this.bot.onText(/\/status/, async (msg) => {
      if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

      const metrics = systemMonitor.getLatest();
      const ncState = nightCommander.getStatus();

      let text = '*🖥 시스템 상태*\n\n';

      if (metrics) {
        text += `CPU: ${metrics.cpu.percent}%\n`;
        text += `RAM: ${metrics.ram.usedGb.toFixed(1)}/${metrics.ram.totalGb.toFixed(1)} GB (${metrics.ram.percent}%)\n`;
        if (metrics.gpu) {
          text += `GPU: ${metrics.gpu.utilPercent}% | VRAM ${metrics.gpu.memUsedMb}/${metrics.gpu.memTotalMb} MB | ${metrics.gpu.tempC}°C\n`;
        }
        text += '\n*서비스:*\n';
        for (const svc of metrics.services || []) {
          const icon = svc.status === 'up' ? '✅' : '❌';
          text += `${icon} ${svc.name} (:${svc.port}) ${svc.responseTime ? svc.responseTime + 'ms' : ''}\n`;
        }
      } else {
        text += '메트릭 데이터 없음\n';
      }

      text += `\n*Night Commander:* ${ncState.running ? '🟢 Running' : '⚪ Stopped'}`;
      text += `\nLoops: ${ncState.loopCount}`;

      await this.bot!.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /workers — 워커 현황
    this.bot.onText(/\/workers/, async (msg) => {
      if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

      const sessions = ptyManager.listAll();
      let text = '*👷 워커 현황*\n\n';

      if (sessions.length === 0) {
        text += '실행 중인 워커 없음';
      } else {
        for (const s of sessions) {
          const icon = s.status === 'running' ? '🟢' : '⚪';
          text += `${icon} *${s.name}* (${s.id})\n`;
          text += `   PID: ${s.pid} | ${s.status}\n`;
        }
      }

      const pending = approvalQueue.getPending();
      if (pending.length > 0) {
        text += `\n*보류 요청: ${pending.length}건*\n`;
        for (const req of pending) {
          text += `- \`${req.requestId}\`: ${req.reason.slice(0, 80)}\n`;
        }
      }

      await this.bot!.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /approve [id] — 보류된 판단 승인
    this.bot.onText(/\/approve\s+(.+)/, async (msg, match) => {
      if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
      const requestId = match?.[1]?.trim();
      if (!requestId) {
        await this.bot!.sendMessage(msg.chat.id, '사용법: /approve <requestId>');
        return;
      }

      try {
        const result = await approvalQueue.approve(requestId);
        const workers = result.createdWorkers?.join(', ') || 'none';
        await this.bot!.sendMessage(
          msg.chat.id,
          `✅ *승인 완료*\nRequest: \`${requestId}\`\nWorkers: ${workers}`,
          { parse_mode: 'Markdown' },
        );
      } catch (err: any) {
        await this.bot!.sendMessage(msg.chat.id, `❌ 승인 실패: ${err.message}`);
      }
    });

    // /deny [id] — 보류된 판단 거부
    this.bot.onText(/\/deny\s+(.+)/, async (msg, match) => {
      if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
      const requestId = match?.[1]?.trim();
      if (!requestId) {
        await this.bot!.sendMessage(msg.chat.id, '사용법: /deny <requestId>');
        return;
      }

      try {
        await approvalQueue.deny(requestId);
        await this.bot!.sendMessage(
          msg.chat.id,
          `🚫 *거부 완료*\nRequest: \`${requestId}\``,
          { parse_mode: 'Markdown' },
        );
      } catch (err: any) {
        await this.bot!.sendMessage(msg.chat.id, `❌ 거부 실패: ${err.message}`);
      }
    });

    // /tasks — 태스크 큐 조회
    this.bot.onText(/\/tasks/, async (msg) => {
      if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

      const tasks = getPendingTasks();
      let text = '*📝 대기 중인 태스크*\n\n';

      if (tasks.length === 0) {
        text += '대기 중인 태스크 없음';
      } else {
        for (const t of tasks.slice(0, 10)) {
          const pIcon = t.priority === 'critical' ? '🔴' : t.priority === 'high' ? '🟠' : '⚪';
          text += `${pIcon} *${t.title}*\n`;
          text += `   ID: \`${t.id}\` | ${t.priority} | ${t.status}\n`;
          if (t.assignedTo) text += `   → ${t.assignedTo}\n`;
        }
        if (tasks.length > 10) {
          text += `\n... 외 ${tasks.length - 10}건`;
        }
      }

      await this.bot!.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // Polling 에러 무시 (graceful)
    this.bot.on('polling_error', (err) => {
      // 연결 끊김 등은 자동 재시도되므로 로그만
      console.error('[Telegram] polling error:', err.message);
    });
  }
}

export const telegramNotifier = new TelegramNotifier();
