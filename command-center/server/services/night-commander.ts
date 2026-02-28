import fs from 'fs';
import path from 'path';
import http from 'http';
import { config } from '../config.js';
import { ptyManager } from './pty-manager.js';
import { getIdleWorkers, getPendingTasks, assignTaskInternal } from '../routes/tasks.js';

import https from 'https';

// ===== Types =====

type DecisionTier = 'tier0' | 'tier1' | 'tier2' | 'tier3';

interface HealthCheckResult {
  service: string;
  port: number;
  status: 'up' | 'down';
  responseTime?: number;
  checkedAt: string;
}

/** Result from an LLM judgment call */
export interface LLMJudgment {
  action: 'ack' | 'instruct' | 'escalate' | 'block' | 'assign_task' | 'restart_service' | 'none';
  instruction: string | null;
  targetWorker: string | null;
  confidence: number; // 0.0 ~ 1.0
  reasoning: string;
  tier: DecisionTier;
}

/** Confidence gate result */
export type ConfidenceAction = 'auto_execute' | 'execute_with_alert' | 'escalate';

interface Decision {
  id: string;
  timestamp: string;
  tier: DecisionTier;
  input: string;
  decision: string;
  action?: string;
  auto: boolean;
  confidence?: number;
  reasoning?: string;
  llmModel?: string;
  confidenceAction?: ConfidenceAction;
}

interface NightCommanderState {
  running: boolean;
  startedAt: string | null;
  lastLoopAt: string | null;
  loopCount: number;
  healthChecks: HealthCheckResult[];
  recentDecisions: Decision[];
  lastDigest: string | null;
  errors: string[];
  apiCostToday: number; // estimated cost in KRW
  apiCostMonth: number;
}

// ===== Constants =====

const LOOP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (autonomous mode)
const DIGEST_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
const HEALTH_TIMEOUT_MS = 5000;
const MAX_RECENT_DECISIONS = 50;
const MAX_ERRORS = 20;

// Cost limits (KRW)
const DAILY_API_COST_LIMIT = 10000;   // 1만원/일
const MONTHLY_API_COST_LIMIT = 200000; // 20만원/월

// Estimated cost per call in KRW (approximate)
const COST_PER_HAIKU_CALL = 0.5;   // ~0.5원
const COST_PER_SONNET_CALL = 2.0;  // ~2원

const SERVICES = [
  { name: 'Dashboard', port: 7777 },
  { name: 'Scheduler', port: 7778 },
  { name: 'Homepage', port: 3000 },
  { name: 'CommandCenter', port: 9000 },
];

// Tier 0: Local Ollama system prompt (simple classification & ACK)
const OLLAMA_SYSTEM_PROMPT = `You are the Autonomous Commander (Tier 0 - Local) of the Lucas Initiative system.
You handle simple operational decisions using local compute only.

Your role:
- Acknowledge routine status updates (task completed, health OK)
- Classify reports as simple/complex
- Answer with brief, structured responses

Always respond in JSON format:
{
  "action": "ack" | "escalate" | "none",
  "instruction": null,
  "targetWorker": null,
  "confidence": 0.0 to 1.0,
  "reasoning": "brief reason",
  "tier": "tier0"
}`;

// Tier 1: Haiku system prompt (worker instructions, quality evaluation, task distribution)
const HAIKU_SYSTEM_PROMPT = `You are the Autonomous Commander (Tier 1 - Haiku) of the Lucas Initiative system.
You make operational decisions and generate worker instructions.

Context:
- You manage Claude Code worker sessions that perform development tasks
- Workers report via inbox files, you respond with instructions
- You operate within defined policies (allow/hold/deny rules)

Your capabilities:
- Generate next-step instructions for workers
- Evaluate report quality and completeness
- Distribute tasks from the task queue to idle workers
- Identify issues that need human escalation

Decision guidelines:
- Worker completed a task: Evaluate quality, assign next task or ACK
- Worker reports an error: Analyze, suggest fix, or escalate if complex
- Worker is idle: Check task queue and assign appropriate work
- Architecture/budget decisions: Always escalate (tier3)

Always respond in JSON format:
{
  "action": "ack" | "instruct" | "assign_task" | "escalate" | "none",
  "instruction": "specific instruction text or null",
  "targetWorker": "worker-X or null",
  "confidence": 0.0 to 1.0,
  "reasoning": "explanation of decision",
  "tier": "tier1"
}`;

// Tier 2: Sonnet system prompt (architecture review, complex analysis)
const SONNET_SYSTEM_PROMPT = `You are the Autonomous Commander (Tier 2 - Sonnet) of the Lucas Initiative system.
You handle complex decisions that require deep analysis.

Your capabilities:
- Architecture review and recommendations
- Complex bug analysis with root cause identification
- Code quality assessment across multiple files
- Impact analysis for proposed changes
- Strategic recommendations

Always respond in JSON format:
{
  "action": "instruct" | "escalate" | "block" | "none",
  "instruction": "detailed instruction or recommendation",
  "targetWorker": "worker-X or null",
  "confidence": 0.0 to 1.0,
  "reasoning": "detailed analysis",
  "tier": "tier2"
}`;

// ===== Policy Loading =====

interface PolicyRule {
  name: string;
  description: string;
  match: {
    keywords?: string[];
    excludeKeywords?: string[];
    type?: string;
  };
  action: 'allow' | 'hold' | 'deny';
  tier: string;
  autoAck?: boolean;
  followUp?: string;
  requireApproval?: boolean;
  requireHuman?: boolean;
  notifyUser?: boolean;
  escalateAfterMinutes?: number;
  maxAutoApprove?: number;
}

interface Policy {
  version: number;
  rules: PolicyRule[];
  cost_limits: {
    claude_api: { monthly_budget_krw: number; daily_limit_krw: number; per_call_limit_krw: number };
    ollama: { max_concurrent_models: number; preferred_model: string; fallback_model: string };
  };
  escalation: {
    levels: Array<{ level: number; name: string; model?: string; timeout_seconds?: number; use_for: string[] }>;
    auto_escalate: { tier2_unresolved_minutes: number; health_down_minutes: number; consecutive_errors: number };
  };
  task_assignment: {
    auto_assign: boolean;
    check_worker_health: boolean;
    max_tasks_per_worker: number;
    unassigned_alert_minutes: number;
  };
  loop: {
    interval_minutes: number;
    digest_interval_hours: number;
    health_check_services: Array<{ name: string; port: number }>;
  };
}

const POLICY_FILE = path.join(config.dataDir, 'policy.yaml');
let cachedPolicy: Policy | null = null;
let policyLoadedAt = 0;

function loadPolicy(): Policy {
  // Cache for 60 seconds
  if (cachedPolicy && Date.now() - policyLoadedAt < 60_000) return cachedPolicy;

  try {
    const raw = fs.readFileSync(POLICY_FILE, 'utf-8');
    // Simple YAML parser for our flat structure (no dependency needed)
    cachedPolicy = parseSimpleYaml(raw);
    policyLoadedAt = Date.now();
    return cachedPolicy!;
  } catch (err: any) {
    log('WARN', `Failed to load policy.yaml: ${err.message}, using defaults`);
    return getDefaultPolicy();
  }
}

function parseSimpleYaml(raw: string): Policy {
  // Extract rules by matching patterns in the YAML
  const rules: PolicyRule[] = [];
  const ruleBlocks = raw.split(/\n  - name: /).slice(1);

  for (const block of ruleBlocks) {
    const lines = ('  - name: ' + block).split('\n');
    const rule: any = { match: {} };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- name:')) rule.name = trimmed.replace('- name:', '').trim();
      if (trimmed.startsWith('description:')) rule.description = trimmed.replace('description:', '').trim();
      if (trimmed.startsWith('action:')) rule.action = trimmed.replace('action:', '').trim();
      if (trimmed.startsWith('tier:')) rule.tier = trimmed.replace('tier:', '').trim();
      if (trimmed.startsWith('autoAck:')) rule.autoAck = trimmed.includes('true');
      if (trimmed.startsWith('followUp:')) rule.followUp = trimmed.replace('followUp:', '').trim();
      if (trimmed.startsWith('requireApproval:')) rule.requireApproval = trimmed.includes('true');
      if (trimmed.startsWith('requireHuman:')) rule.requireHuman = trimmed.includes('true');
      if (trimmed.startsWith('notifyUser:')) rule.notifyUser = trimmed.includes('true');
      if (trimmed.startsWith('escalateAfterMinutes:')) rule.escalateAfterMinutes = parseInt(trimmed.split(':')[1]);
      if (trimmed.startsWith('maxAutoApprove:')) rule.maxAutoApprove = parseInt(trimmed.split(':')[1]);

      // Parse keywords array
      if (trimmed.startsWith('keywords:')) {
        const kwMatch = trimmed.match(/\[([^\]]+)\]/);
        if (kwMatch) {
          rule.match.keywords = kwMatch[1].split(',').map((k: string) => k.trim().replace(/"/g, ''));
        }
      }
      if (trimmed.startsWith('excludeKeywords:')) {
        const kwMatch = trimmed.match(/\[([^\]]+)\]/);
        if (kwMatch) {
          rule.match.excludeKeywords = kwMatch[1].split(',').map((k: string) => k.trim().replace(/"/g, ''));
        }
      }
      if (trimmed.startsWith('type:') && line.includes('match')) {
        // Skip — this is under match block
      } else if (trimmed.startsWith('type:') && !line.includes('match')) {
        rule.match.type = trimmed.replace('type:', '').trim();
      }
    }

    if (rule.name) rules.push(rule as PolicyRule);
  }

  // Extract task_assignment settings
  const autoAssignMatch = raw.match(/auto_assign:\s*(true|false)/);
  const maxTasksMatch = raw.match(/max_tasks_per_worker:\s*(\d+)/);
  const unassignedAlertMatch = raw.match(/unassigned_alert_minutes:\s*(\d+)/);

  return {
    version: 1,
    rules,
    cost_limits: {
      claude_api: { monthly_budget_krw: 200000, daily_limit_krw: 20000, per_call_limit_krw: 5000 },
      ollama: { max_concurrent_models: 2, preferred_model: 'qwen2.5:14b', fallback_model: 'deepseek-r1:8b' },
    },
    escalation: {
      levels: [
        { level: 1, name: 'ollama-local', model: 'qwen2.5:14b', timeout_seconds: 60, use_for: ['tier1', 'tier2'] },
        { level: 2, name: 'claude-api', model: 'claude-sonnet-4-20250514', timeout_seconds: 30, use_for: ['tier2'] },
        { level: 3, name: 'human', use_for: ['tier3'] },
      ],
      auto_escalate: { tier2_unresolved_minutes: 30, health_down_minutes: 10, consecutive_errors: 3 },
    },
    task_assignment: {
      auto_assign: autoAssignMatch ? autoAssignMatch[1] === 'true' : true,
      check_worker_health: true,
      max_tasks_per_worker: maxTasksMatch ? parseInt(maxTasksMatch[1]) : 1,
      unassigned_alert_minutes: unassignedAlertMatch ? parseInt(unassignedAlertMatch[1]) : 15,
    },
    loop: {
      interval_minutes: 5,
      digest_interval_hours: 8,
      health_check_services: SERVICES.map(s => ({ name: s.name, port: s.port })),
    },
  };
}

function getDefaultPolicy(): Policy {
  return {
    version: 1,
    rules: [],
    cost_limits: {
      claude_api: { monthly_budget_krw: 200000, daily_limit_krw: 20000, per_call_limit_krw: 5000 },
      ollama: { max_concurrent_models: 2, preferred_model: 'qwen2.5:14b', fallback_model: 'deepseek-r1:8b' },
    },
    escalation: {
      levels: [],
      auto_escalate: { tier2_unresolved_minutes: 30, health_down_minutes: 10, consecutive_errors: 3 },
    },
    task_assignment: { auto_assign: true, check_worker_health: true, max_tasks_per_worker: 1, unassigned_alert_minutes: 15 },
    loop: { interval_minutes: 5, digest_interval_hours: 8, health_check_services: [] },
  };
}

// ===== Action Executor =====

/**
 * Sends an instruction to a worker via inbox file + PTY notification.
 * This is the core of the autonomous commander — it can ACT, not just observe.
 */
function executeInstruction(workerId: string, instruction: string, source: string = 'night-commander'): boolean {
  try {
    const inboxDir = path.join(config.coordinationDir, 'inbox');
    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });

    const now = new Date().toISOString();
    const msgId = Date.now();
    const msgFile = `instruct-${workerId}-${msgId}.md`;
    const msgPath = path.join(inboxDir, msgFile);

    const fileContent = [
      `# Instruction from Autonomous Commander`,
      `> ${now}`,
      `> To: ${workerId}`,
      `> Source: ${source}`,
      '',
      instruction,
    ].join('\n');

    fs.writeFileSync(msgPath, fileContent, 'utf-8');

    // Inject ASCII notification into worker PTY
    if (ptyManager.isRunning(workerId)) {
      const notification = `[COMMANDER INSTRUCTION] Read file: .coordination/inbox/${msgFile}`;
      ptyManager.write(workerId, notification);
      setTimeout(() => ptyManager.write(workerId, '\r'), 50);
      log('INFO', `[ActionExecutor] Instruction sent to ${workerId}: ${instruction.slice(0, 100)}...`);
      return true;
    } else {
      log('WARN', `[ActionExecutor] Worker ${workerId} not running, instruction saved to inbox only`);
      return false;
    }
  } catch (err: any) {
    log('ERROR', `[ActionExecutor] Failed to send instruction to ${workerId}: ${err.message}`);
    return false;
  }
}

/**
 * Auto-assign pending tasks to idle workers.
 */
function autoAssignTasks(): number {
  const policy = loadPolicy();
  if (!policy.task_assignment.auto_assign) return 0;

  const idleWorkers = getIdleWorkers();
  const pendingTasks = getPendingTasks();

  if (idleWorkers.length === 0 || pendingTasks.length === 0) return 0;

  let assigned = 0;
  for (const workerId of idleWorkers) {
    if (pendingTasks.length <= assigned) break;

    const task = pendingTasks[assigned];
    const result = assignTaskInternal(task.id, workerId);
    if (result) {
      log('INFO', `[TaskAssigner] Assigned "${task.title}" to ${workerId}`);
      assigned++;
    }
  }

  return assigned;
}

// ===== Log Helpers =====

const logDir = path.join(config.coordinationDir, 'logs');
const digestDir = path.join(config.coordinationDir, 'digests');
const logFile = path.join(logDir, 'night-commander.log');
const decisionsFile = path.join(config.dataDir, 'decisions.jsonl');

function ensureDirs() {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(digestDir)) fs.mkdirSync(digestDir, { recursive: true });
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function log(level: string, message: string) {
  ensureDirs();
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch { /* ignore */ }
  console.log(`[NightCommander] [${level}] ${message}`);
}

/** Persist decision to decisions.jsonl for audit trail */
function logDecision(decision: Decision) {
  ensureDirs();
  try {
    fs.appendFileSync(decisionsFile, JSON.stringify(decision) + '\n', 'utf-8');
  } catch (err: any) {
    log('ERROR', `Failed to log decision: ${err.message}`);
  }
}

// ===== Ollama Integration =====

async function queryOllama(prompt: string, model = 'qwen2.5:14b'): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: { temperature: 0.3 },
    });

    const req = http.request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.message?.content || data);
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timeout'));
    });
    req.write(body);
    req.end();
  });
}

// ===== Claude API Escalation =====

async function queryClaudeAPI(prompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are the Night Commander AI for Lucas Initiative. Evaluate this and provide a decision.\n\n${prompt}`,
        },
      ],
    });

    const req = http.request(
      {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content?.[0]?.text || data;
            resolve(text);
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

// ===== Health Check =====

function httpPing(port: number): Promise<HealthCheckResult> {
  const service = SERVICES.find((s) => s.port === port)?.name || `Port ${port}`;
  const start = Date.now();

  return new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port, path: '/', method: 'GET', timeout: HEALTH_TIMEOUT_MS },
      (res) => {
        res.resume(); // drain
        resolve({
          service,
          port,
          status: 'up',
          responseTime: Date.now() - start,
          checkedAt: new Date().toISOString(),
        });
      },
    );
    req.on('error', () => {
      resolve({
        service,
        port,
        status: 'down',
        checkedAt: new Date().toISOString(),
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        service,
        port,
        status: 'down',
        checkedAt: new Date().toISOString(),
      });
    });
    req.end();
  });
}

async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const results = await Promise.all(SERVICES.map((s) => httpPing(s.port)));
  for (const r of results) {
    if (r.status === 'down') {
      log('WARN', `Service DOWN: ${r.service} (:${r.port})`);
    }
  }
  return results;
}

// ===== Inbox Processing =====

function getNewReports(since: string | null): string[] {
  const inboxDir = path.join(config.coordinationDir, 'inbox');
  if (!fs.existsSync(inboxDir)) return [];

  const files = fs.readdirSync(inboxDir).filter((f) => f.startsWith('report-') && f.endsWith('.md'));

  if (!since) return [];

  const sinceTime = new Date(since).getTime();
  return files.filter((f) => {
    // Extract timestamp from filename: report-worker-N-TIMESTAMP.md
    const match = f.match(/(\d{10,})\.md$/);
    if (!match) return false;
    return parseInt(match[1]) > sinceTime;
  });
}

function readInboxFile(filename: string): string {
  const filepath = path.join(config.coordinationDir, 'inbox', filename);
  try {
    return fs.readFileSync(filepath, 'utf-8');
  } catch {
    return '';
  }
}

// ===== Decision Engine =====

interface PolicyMatchResult {
  tier: DecisionTier;
  rule: PolicyRule | null;
  action: 'allow' | 'hold' | 'deny';
}

function classifyDecision(content: string): DecisionTier {
  const result = classifyWithPolicy(content);
  return result.tier;
}

function classifyWithPolicy(content: string): PolicyMatchResult {
  const policy = loadPolicy();
  const lower = content.toLowerCase();

  // Try policy rules first
  for (const rule of policy.rules) {
    if (!rule.match) continue;

    // Check keywords match
    const keywords = rule.match.keywords || [];
    const excludeKeywords = rule.match.excludeKeywords || [];

    const hasKeyword = keywords.length === 0 || keywords.some(k => lower.includes(k.toLowerCase()));
    const hasExclude = excludeKeywords.some(k => lower.includes(k.toLowerCase()));

    if (hasKeyword && !hasExclude && keywords.length > 0) {
      const tier = (rule.tier || 'tier1') as DecisionTier;
      return { tier, rule, action: rule.action };
    }
  }

  // Fallback to hardcoded classification
  const tier3Keywords = ['budget', '예산', 'architecture', '아키텍처', 'new project', '신규', 'needsUserDecision', 'USER DECISION NEEDED'];
  if (tier3Keywords.some((k) => lower.includes(k.toLowerCase()))) {
    return { tier: 'tier3', rule: null, action: 'deny' };
  }

  const tier2Keywords = ['quality', '품질', 'evaluation', '평가', 'complex', '복잡', 'error', '에러', 'bug', '버그', 'blocker', '블로커'];
  if (tier2Keywords.some((k) => lower.includes(k.toLowerCase()))) {
    return { tier: 'tier2', rule: null, action: 'hold' };
  }

  return { tier: 'tier1', rule: null, action: 'allow' };
}

async function processReport(filename: string, content: string): Promise<Decision> {
  const classification = classifyWithPolicy(content);
  const { tier, rule } = classification;
  const id = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  log('INFO', `Processing report: ${filename} -> ${tier} (rule: ${rule?.name || 'hardcoded'})`);

  // Extract worker name from filename for targeted responses
  const workerMatch = filename.match(/report-(worker-\d+)-/);
  const reportingWorker = workerMatch ? workerMatch[1] : null;

  if (tier === 'tier3') {
    const decision: Decision = {
      id,
      timestamp: new Date().toISOString(),
      tier: 'tier3',
      input: filename,
      decision: 'Flagged for human review - requires Lucas decision',
      action: 'Logged to pending human decisions',
      auto: false,
    };
    logDecision(decision);
    log('INFO', `Tier 3 (Human): ${filename} - awaiting Lucas`);
    return decision;
  }

  // For auto-ACK rules, skip LLM entirely
  if (rule?.autoAck && classification.action === 'allow') {
    const decision: Decision = {
      id,
      timestamp: new Date().toISOString(),
      tier: tier as DecisionTier,
      input: filename,
      decision: `Auto-ACK by policy rule "${rule.name}": ${content.slice(0, 200)}`,
      action: rule.followUp || 'none',
      auto: true,
      confidence: 1.0,
      reasoning: `Matched policy rule: ${rule.name}`,
    };

    // If followUp is check-next-task, try to assign next task to the worker
    if (rule.followUp === 'check-next-task' && reportingWorker) {
      const pendingTasks = getPendingTasks();
      if (pendingTasks.length > 0) {
        const task = pendingTasks[0];
        const assigned = assignTaskInternal(task.id, reportingWorker);
        if (assigned) {
          decision.action = `Assigned next task "${task.title}" to ${reportingWorker}`;
          log('INFO', `[ActionExecutor] Auto-assigned "${task.title}" to ${reportingWorker} after task completion`);
        }
      }
    }

    logDecision(decision);
    return decision;
  }

  // Tier 1 & 2: Ask LLM for judgment
  try {
    const prompt = `A worker submitted this report. Evaluate and decide what action to take.
If the worker completed a task, acknowledge and check if there's follow-up work.
If there's an error, suggest a fix or escalate.
If the worker is idle, consider assigning new work.

Filename: ${filename}
Reporting worker: ${reportingWorker || 'unknown'}
Content:
${content}`;

    let response: string;
    let llmModel = 'qwen2.5:14b';

    if (tier === 'tier2' && process.env.ANTHROPIC_API_KEY) {
      const claudeResponse = await queryClaudeAPI(prompt);
      response = claudeResponse || await queryOllama(prompt);
      llmModel = claudeResponse ? 'claude-sonnet-4' : 'qwen2.5:14b';
      log('INFO', `Tier 2 decision via ${claudeResponse ? 'Claude API' : 'Ollama fallback'}`);
    } else {
      response = await queryOllama(prompt);
      log('INFO', `Tier 1 decision via Ollama (14B)`);
    }

    // Try to parse structured JSON response
    let parsed: LLMJudgment | null = null;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* non-JSON response */ }

    const decision: Decision = {
      id,
      timestamp: new Date().toISOString(),
      tier: (parsed?.tier || tier) as DecisionTier,
      input: filename,
      decision: parsed?.reasoning || parsed?.decision || response.slice(0, 500),
      action: parsed?.action || null,
      auto: true,
      confidence: parsed?.confidence,
      reasoning: parsed?.reasoning,
      llmModel,
    };

    // ===== ACTION EXECUTOR: Execute the LLM's judgment =====
    if (parsed && parsed.action === 'instruct' && parsed.instruction && parsed.targetWorker) {
      // Confidence gate: only auto-execute if confidence >= 0.7
      const confidence = parsed.confidence ?? 0;
      if (confidence >= 0.7) {
        const sent = executeInstruction(parsed.targetWorker, parsed.instruction, `night-commander/${tier}`);
        decision.action = sent
          ? `Instruction sent to ${parsed.targetWorker}: ${parsed.instruction.slice(0, 100)}`
          : `Instruction saved (worker offline): ${parsed.instruction.slice(0, 100)}`;
        decision.confidenceAction = confidence >= 0.9 ? 'auto_execute' : 'execute_with_alert';
        log('INFO', `[ActionExecutor] Executed instruction to ${parsed.targetWorker} (confidence: ${confidence})`);
      } else {
        decision.action = `Hold (low confidence ${confidence}): ${parsed.instruction?.slice(0, 100)}`;
        decision.confidenceAction = 'escalate';
        log('INFO', `[ActionExecutor] Held instruction (confidence ${confidence} < 0.7)`);
      }
    } else if (parsed?.action === 'assign_task' && reportingWorker) {
      // Auto-assign next task
      const pendingTasks = getPendingTasks();
      if (pendingTasks.length > 0) {
        const task = pendingTasks[0];
        const assigned = assignTaskInternal(task.id, reportingWorker);
        if (assigned) {
          decision.action = `Assigned task "${task.title}" to ${reportingWorker}`;
        }
      }
    } else if (parsed?.action === 'escalate') {
      decision.auto = false;
      decision.action = 'Escalated to human review';
    }

    logDecision(decision);
    return decision;
  } catch (err: any) {
    log('ERROR', `LLM query failed for ${filename}: ${err.message}`);
    const decision: Decision = {
      id,
      timestamp: new Date().toISOString(),
      tier: tier as DecisionTier,
      input: filename,
      decision: `Auto-ACK (LLM unavailable): ${content.slice(0, 200)}`,
      action: null,
      auto: true,
    };
    logDecision(decision);
    return decision;
  }
}

// ===== Digest Generation =====

function generateDigest(state: NightCommanderState): string {
  const now = new Date();
  const header = `# Night Commander Digest\n> Generated: ${now.toISOString()}\n> Loop count: ${state.loopCount}\n`;

  // Server status
  let serverSection = '\n## Server Status\n\n| Service | Port | Status | Response |\n|---------|------|--------|----------|\n';
  for (const hc of state.healthChecks) {
    serverSection += `| ${hc.service} | ${hc.port} | ${hc.status === 'up' ? 'UP' : 'DOWN'} | ${hc.responseTime ? `${hc.responseTime}ms` : 'N/A'} |\n`;
  }

  // Worker activity from coordination files
  let workerSection = '\n## Worker Activity Summary\n\n';
  try {
    const coordFiles = fs.readdirSync(config.coordinationDir).filter((f) => f.startsWith('worker-') && f.endsWith('.md'));
    for (const file of coordFiles) {
      const content = fs.readFileSync(path.join(config.coordinationDir, file), 'utf-8');
      const firstLine = content.split('\n').find((l) => l.trim().length > 0) || file;
      workerSection += `### ${file}\n${content.slice(0, 300)}\n\n`;
    }
  } catch { workerSection += 'Unable to read worker files\n'; }

  // Decisions
  let decisionSection = '\n## Auto-Processed Decisions\n\n';
  const autoDecisions = state.recentDecisions.filter((d) => d.auto);
  if (autoDecisions.length === 0) {
    decisionSection += 'No auto-processed decisions in this period.\n';
  } else {
    for (const d of autoDecisions) {
      decisionSection += `- **[${d.tier}]** ${d.input}: ${d.decision.slice(0, 150)}\n`;
    }
  }

  // Pending Tier 3
  let tier3Section = '\n## Pending Human Decisions (Tier 3)\n\n';
  const tier3 = state.recentDecisions.filter((d) => d.tier === 'tier3' && !d.auto);
  if (tier3.length === 0) {
    tier3Section += 'No pending human decisions.\n';
  } else {
    for (const d of tier3) {
      tier3Section += `- **${d.input}**: ${d.decision}\n`;
    }
  }

  // Errors
  let errorSection = '';
  if (state.errors.length > 0) {
    errorSection = '\n## Errors\n\n';
    for (const e of state.errors.slice(-10)) {
      errorSection += `- ${e}\n`;
    }
  }

  return header + serverSection + workerSection + decisionSection + tier3Section + errorSection;
}

function saveDigest(content: string): string {
  ensureDirs();
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const filename = `digest-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}.md`;
  const filepath = path.join(digestDir, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  log('INFO', `Digest saved: ${filename}`);
  return filepath;
}

function getLatestDigest(): string | null {
  ensureDirs();
  try {
    const files = fs.readdirSync(digestDir).filter((f) => f.startsWith('digest-') && f.endsWith('.md')).sort();
    if (files.length === 0) return null;
    return fs.readFileSync(path.join(digestDir, files[files.length - 1]), 'utf-8');
  } catch {
    return null;
  }
}

// ===== Night Commander Class =====

class NightCommander {
  private state: NightCommanderState = {
    running: false,
    startedAt: null,
    lastLoopAt: null,
    loopCount: 0,
    healthChecks: [],
    recentDecisions: [],
    lastDigest: null,
    errors: [],
    apiCostToday: 0,
    apiCostMonth: 0,
  };

  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private digestTimer: ReturnType<typeof setInterval> | null = null;

  getStatus(): NightCommanderState {
    return { ...this.state };
  }

  getLatestDigest(): string | null {
    return getLatestDigest();
  }

  start() {
    if (this.state.running) {
      log('WARN', 'Already running');
      return;
    }

    log('INFO', '=== Night Commander STARTED ===');
    this.state.running = true;
    this.state.startedAt = new Date().toISOString();
    this.state.errors = [];

    // Run first loop immediately
    this.runLoop();

    // Schedule loops every 5 minutes (autonomous mode)
    this.loopTimer = setInterval(() => this.runLoop(), LOOP_INTERVAL_MS);

    // Schedule digests every 8 hours
    this.digestTimer = setInterval(() => this.createDigest(), DIGEST_INTERVAL_MS);
  }

  stop() {
    if (!this.state.running) {
      log('WARN', 'Not running');
      return;
    }

    log('INFO', '=== Night Commander STOPPED ===');
    this.state.running = false;

    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.digestTimer) {
      clearInterval(this.digestTimer);
      this.digestTimer = null;
    }

    // Generate final digest on stop
    this.createDigest();
  }

  private async runLoop() {
    const loopStart = new Date().toISOString();
    log('INFO', `--- Loop #${this.state.loopCount + 1} started ---`);

    try {
      // 1. Health checks
      this.state.healthChecks = await runHealthChecks();
      const downServices = this.state.healthChecks.filter((h) => h.status === 'down');
      if (downServices.length > 0) {
        const names = downServices.map((d) => `${d.service}(:${d.port})`).join(', ');
        log('WARN', `Down services: ${names}`);
      }

      // 2. Process new reports (with Action Executor)
      const newReports = getNewReports(this.state.lastLoopAt);
      if (newReports.length > 0) {
        log('INFO', `Processing ${newReports.length} new report(s)`);
        for (const filename of newReports) {
          try {
            const content = readInboxFile(filename);
            if (!content) continue;
            const decision = await processReport(filename, content);
            this.state.recentDecisions.push(decision);
            // Trim decisions list
            if (this.state.recentDecisions.length > MAX_RECENT_DECISIONS) {
              this.state.recentDecisions = this.state.recentDecisions.slice(-MAX_RECENT_DECISIONS);
            }
          } catch (err: any) {
            const errMsg = `Failed to process report ${filename}: ${err.message}`;
            log('ERROR', errMsg);
            this.addError(errMsg);
          }
        }
      }

      // 3. Auto-assign pending tasks to idle workers
      try {
        const assignedCount = autoAssignTasks();
        if (assignedCount > 0) {
          log('INFO', `[TaskAssigner] Auto-assigned ${assignedCount} task(s) to idle workers`);
        }
      } catch (err: any) {
        log('ERROR', `Task auto-assignment failed: ${err.message}`);
      }

      // 4. Check for stale conditions
      try {
        const policy = loadPolicy();
        const idleWorkers = getIdleWorkers();
        const pendingTasks = getPendingTasks();

        // Alert if there are pending tasks but no idle workers
        if (pendingTasks.length > 0 && idleWorkers.length === 0) {
          log('WARN', `${pendingTasks.length} pending task(s) but no idle workers available`);
        }

        // Log loop summary
        log('INFO', `Loop summary: ${downServices.length} down, ${newReports.length} reports, ${idleWorkers.length} idle workers, ${pendingTasks.length} pending tasks`);
      } catch { /* ignore summary errors */ }

      this.state.lastLoopAt = loopStart;
      this.state.loopCount++;
      log('INFO', `--- Loop #${this.state.loopCount} completed ---`);
    } catch (err: any) {
      const errMsg = `Loop error: ${err.message}`;
      log('ERROR', errMsg);
      this.addError(errMsg);
    }
  }

  private createDigest() {
    try {
      const content = generateDigest(this.state);
      const filepath = saveDigest(content);
      this.state.lastDigest = filepath;
    } catch (err: any) {
      const errMsg = `Digest generation failed: ${err.message}`;
      log('ERROR', errMsg);
      this.addError(errMsg);
    }
  }

  private addError(msg: string) {
    this.state.errors.push(`[${new Date().toISOString()}] ${msg}`);
    if (this.state.errors.length > MAX_ERRORS) {
      this.state.errors = this.state.errors.slice(-MAX_ERRORS);
    }
  }
}

export const nightCommander = new NightCommander();
