import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { ptyManager } from './pty-manager.js';

export interface WorkerCreateOptions {
  mission?: string;
  targetProject?: string;
  autoSpawn?: boolean;
  requestedBy?: 'ui' | 'commander';
}

export interface WorkerCreateResult {
  id: string;
  name: string;
  cwd: string;
  color: string;
  mission?: string;
  targetProject?: string;
  spawned: boolean;
}

interface SessionConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  autoStart: boolean;
  color: string;
  type?: 'commander' | 'static' | 'dynamic';
  mission?: string;
  targetProject?: string;
  createdAt?: string;
}

const COLOR_POOL = [
  '#60a5fa', // blue
  '#34d399', // emerald
  '#facc15', // yellow
  '#c084fc', // purple
  '#fb923c', // orange
  '#f472b6', // pink
  '#2dd4bf', // teal
  '#a78bfa', // violet
  '#38bdf8', // sky
  '#4ade80', // green
];

class WorkerLifecycle {
  private loadConfigs(): SessionConfig[] {
    try {
      return JSON.parse(fs.readFileSync(config.sessionsFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  private saveConfigs(configs: SessionConfig[]): void {
    fs.writeFileSync(config.sessionsFile, JSON.stringify(configs, null, 2), 'utf-8');
  }

  getNextId(): string {
    const configs = this.loadConfigs();
    let max = 0;
    for (const c of configs) {
      const match = c.id.match(/^worker-(\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1]));
    }
    return `worker-${max + 1}`;
  }

  private pickColor(): string {
    const configs = this.loadConfigs();
    const usedColors = new Set(configs.map(c => c.color));
    for (const color of COLOR_POOL) {
      if (!usedColors.has(color)) return color;
    }
    // All used — cycle
    return COLOR_POOL[configs.length % COLOR_POOL.length];
  }

  async create(options: WorkerCreateOptions = {}): Promise<WorkerCreateResult> {
    const configs = this.loadConfigs();

    // Check max workers
    const workerCount = configs.filter(c => c.id !== 'commander').length;
    if (workerCount >= config.maxWorkers) {
      throw new Error(`Max workers (${config.maxWorkers}) reached`);
    }

    const id = this.getNextId();
    const name = `Worker-${id.split('-')[1]}`;
    const cwd = path.join(config.agentsDir, id);
    const color = this.pickColor();

    // 1. Create agent directory
    fs.mkdirSync(cwd, { recursive: true });

    // 2. Write CLAUDE.md
    fs.writeFileSync(
      path.join(cwd, 'CLAUDE.md'),
      this.generateClaudeMd(id, name, options.mission, options.targetProject),
      'utf-8'
    );

    // 3. Write activity.md
    fs.writeFileSync(
      path.join(cwd, 'activity.md'),
      this.generateActivityMd(options.mission),
      'utf-8'
    );

    // 4. Create coordination status file
    const coordFile = path.join(config.coordinationDir, `${id}.md`);
    fs.writeFileSync(
      coordFile,
      this.generateCoordinationMd(name, options.mission, options.targetProject),
      'utf-8'
    );

    // 5. Add to sessions.json
    const newConfig: SessionConfig = {
      id,
      name,
      cwd,
      command: 'claude',
      autoStart: false,
      color,
      type: 'dynamic',
      mission: options.mission,
      targetProject: options.targetProject,
      createdAt: new Date().toISOString(),
    };
    configs.push(newConfig);
    this.saveConfigs(configs);

    // 6. Auto-spawn if requested
    let spawned = false;
    if (options.autoSpawn) {
      try {
        ptyManager.spawn(id, name, cwd, 'claude');
        spawned = true;
      } catch (err: any) {
        console.error(`[WorkerLifecycle] Failed to auto-spawn ${id}: ${err.message}`);
      }
    }

    // 7. If mission provided, create inbox instruction
    if (options.mission) {
      const inboxDir = path.join(config.coordinationDir, 'inbox');
      if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
      const msgFile = `instruct-${id}-${Date.now()}.md`;
      fs.writeFileSync(
        path.join(inboxDir, msgFile),
        `# Initial Mission from Commander\n> ${new Date().toISOString()}\n> To: ${id}\n\n${options.mission}`,
        'utf-8'
      );
    }

    console.log(`[WorkerLifecycle] Created ${name} (${id}) at ${cwd}`);
    return { id, name, cwd, color, mission: options.mission, targetProject: options.targetProject, spawned };
  }

  async delete(id: string, options: { archive?: boolean } = { archive: true }): Promise<void> {
    // Can't delete commander or non-existent
    if (id === 'commander') throw new Error('Cannot delete commander');

    const configs = this.loadConfigs();
    const idx = configs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error(`Worker "${id}" not found`);

    // Kill if running — wait for process to fully release file locks (Windows)
    if (ptyManager.isRunning(id)) {
      ptyManager.kill(id);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const workerConfig = configs[idx];
    const agentDir = workerConfig.cwd;

    // Remove from sessions.json first (always succeeds)
    configs.splice(idx, 1);
    this.saveConfigs(configs);

    // Archive or delete agent directory (retry on EBUSY for Windows file locks)
    const moveOrDelete = async () => {
      if (options.archive && fs.existsSync(agentDir)) {
        const archiveDir = config.agentsArchiveDir;
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        const archiveDest = path.join(archiveDir, `${id}-${Date.now()}`);
        fs.renameSync(agentDir, archiveDest);
        console.log(`[WorkerLifecycle] Archived ${id} to ${archiveDest}`);
      } else if (fs.existsSync(agentDir)) {
        fs.rmSync(agentDir, { recursive: true, force: true });
      }
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await moveOrDelete();
        break;
      } catch (err: any) {
        if (err.code === 'EBUSY' && attempt < 2) {
          console.log(`[WorkerLifecycle] ${id} directory busy, retrying in ${(attempt + 1) * 500}ms...`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
        } else {
          console.error(`[WorkerLifecycle] Failed to archive ${id}: ${err.message} (will clean up later)`);
          break; // Session already removed from config — directory cleanup can happen later
        }
      }
    }

    // Remove coordination file
    const coordFile = path.join(config.coordinationDir, `${id}.md`);
    try { if (fs.existsSync(coordFile)) fs.unlinkSync(coordFile); } catch { /* ignore */ }

    console.log(`[WorkerLifecycle] Deleted ${id}`);
  }

  list(): Array<SessionConfig & { running: boolean; pid?: number }> {
    const configs = this.loadConfigs();
    const active = ptyManager.list();
    const activeMap = new Map(active.map(a => [a.id, a]));

    return configs
      .filter(c => c.id !== 'commander')
      .map(c => ({
        ...c,
        running: activeMap.has(c.id),
        pid: activeMap.get(c.id)?.pid,
      }));
  }

  private generateClaudeMd(id: string, name: string, mission?: string, targetProject?: string): string {
    return `# ${name} - Lucas Initiative

## 역할
너는 Lucas Initiative의 **${name}**이다. Commander의 지시에 따라 작업을 수행한다.

${mission ? `## 현재 미션\n${mission}\n` : ''}
${targetProject ? `## 작업 대상 프로젝트\n${targetProject}\n` : ''}

## 핵심 규칙
1. **지시 수신**: 프롬프트로 \`[COMMANDER INSTRUCTION] Read file: .coordination/inbox/instruct-${id}-xxx.md\` 형태의 알림이 오면, **반드시 해당 파일을 읽어서** 지시 내용을 확인한 후 작업을 수행한다.
2. **작업 완료 시 보고**: 작업이 끝나면 반드시 Command Center API로 보고한다.
3. **활동 기록**: 모든 작업 내역을 이 폴더의 \`activity.md\`에 기록한다. 세션이 끊겨도 다음 세션에서 이어갈 수 있도록.
4. **판단 불가 시 에스컬레이션**: 스스로 판단할 수 없는 건 보고에 \`needsUserDecision: true\`를 포함한다.

## 지시 수신 흐름
1. 프롬프트로 파일 경로 알림이 옴 (ASCII만, 한글 없음)
2. 해당 \`.coordination/inbox/instruct-*.md\` 파일을 Read로 읽음
3. 파일 내용에 한글 지시사항이 있으니 그대로 수행
4. 완료 후 보고 API 호출

## 보고 방법 (인코딩 주의)

**중요: MINGW bash에서 \`curl -d\` 인라인에 한글을 넣으면 깨진다. 반드시 파일 경유 방식을 사용할 것.**

\`\`\`bash
# 올바른 방법 (파일 경유 — 한글 안 깨짐)
printf '{"worker":"${id}","report":"작업 내용 및 결과 요약","needsUserDecision":false}' > /tmp/_report.json
curl -s -X POST http://localhost:9000/api/report -H "Content-Type: application/json; charset=utf-8" --data-binary @/tmp/_report.json
\`\`\`

\`\`\`bash
# 금지 (한글 깨짐)
curl -d '{"worker":"${id}","report":"한글내용"}' ...
\`\`\`

## 활동 기록 (activity.md)
매 작업마다 아래 형식으로 기록:
\`\`\`markdown
## YYYY-MM-DD HH:MM - 작업 제목
- 지시: Commander로부터 받은 지시
- 수행: 실제 수행한 내용
- 결과: 결과 요약
- 상태: 완료/진행중/블록
\`\`\`

## 참조 경로
- 조율 폴더: \`G:\\Lucas-Initiative\\.coordination\\\`
- inbox: \`G:\\Lucas-Initiative\\.coordination\\inbox\\\` (메시지 수신함)
- MASTER.md: 사령관 지시서 (읽기만)
- 프로젝트 루트: \`G:\\Lucas-Initiative\\\`

## 금지
- MASTER.md 수정 금지
- 다른 워커 폴더 수정 금지
- Commander 폴더 수정 금지
`;
  }

  private generateActivityMd(mission?: string): string {
    return `# Activity Log

> 세션이 끊겨도 이 파일을 읽어서 컨텍스트를 복원하세요.

## 현재 상태
- 첫 지시 대기중

${mission ? `## 미션\n${mission}\n` : '## 미션\n미배정\n'}

## 작업 이력
(아직 없음)
`;
  }

  private generateCoordinationMd(name: string, mission?: string, targetProject?: string): string {
    return `# ${name} Status

> **이 파일은 ${name}만 작성합니다.**
> Last updated: ${new Date().toISOString()}

## 할당 범위
- 미션: ${mission || '미배정'}
- 대상: ${targetProject || 'TBD'}

---

## 현재 작업
- [ ] 지시 대기중

---

## 완료 작업

(없음)

---

## 사령탑에 요청/보고

(없음)
`;
  }
}

export const workerLifecycle = new WorkerLifecycle();
