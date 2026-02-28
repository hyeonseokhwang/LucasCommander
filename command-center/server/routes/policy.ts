import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const policyRouter = Router();

const POLICY_FILE = path.join(config.dataDir, 'policy.yaml');

// GET /api/policy — read policy.yaml and return raw + parsed rules
policyRouter.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(POLICY_FILE)) {
      res.status(404).json({ error: 'policy.yaml not found' });
      return;
    }
    const raw = fs.readFileSync(POLICY_FILE, 'utf-8');
    const parsed = parsePolicy(raw);
    res.json({ raw, parsed, lastModified: fs.statSync(POLICY_FILE).mtime.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/policy — overwrite policy.yaml with new content
policyRouter.put('/', (req, res) => {
  const { raw } = req.body;
  if (!raw || typeof raw !== 'string') {
    res.status(400).json({ error: 'raw (string) is required in body' });
    return;
  }

  try {
    // Validate: try parsing before saving
    const parsed = parsePolicy(raw);
    if (!parsed.rules || parsed.rules.length === 0) {
      res.status(400).json({ error: 'Invalid policy: no rules found after parsing' });
      return;
    }

    // Backup current file
    if (fs.existsSync(POLICY_FILE)) {
      const backup = POLICY_FILE + '.bak';
      fs.copyFileSync(POLICY_FILE, backup);
    }

    fs.writeFileSync(POLICY_FILE, raw, 'utf-8');
    res.json({ status: 'saved', parsed, lastModified: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Minimal YAML parser (same logic as night-commander service) ---

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

interface ParsedPolicy {
  version: number;
  rules: PolicyRule[];
  cost_limits: any;
  escalation: any;
  task_assignment: any;
  loop: any;
}

function parsePolicy(raw: string): ParsedPolicy {
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
    }

    if (rule.name) rules.push(rule as PolicyRule);
  }

  // Extract other sections
  const autoAssignMatch = raw.match(/auto_assign:\s*(true|false)/);
  const maxTasksMatch = raw.match(/max_tasks_per_worker:\s*(\d+)/);
  const unassignedAlertMatch = raw.match(/unassigned_alert_minutes:\s*(\d+)/);
  const intervalMatch = raw.match(/interval_minutes:\s*(\d+)/);
  const digestMatch = raw.match(/digest_interval_hours:\s*(\d+)/);
  const monthlyBudgetMatch = raw.match(/monthly_budget_krw:\s*(\d+)/);
  const dailyLimitMatch = raw.match(/daily_limit_krw:\s*(\d+)/);
  const preferredModelMatch = raw.match(/preferred_model:\s*"([^"]+)"/);

  return {
    version: 1,
    rules,
    cost_limits: {
      claude_api: {
        monthly_budget_krw: monthlyBudgetMatch ? parseInt(monthlyBudgetMatch[1]) : 200000,
        daily_limit_krw: dailyLimitMatch ? parseInt(dailyLimitMatch[1]) : 20000,
      },
      ollama: {
        preferred_model: preferredModelMatch ? preferredModelMatch[1] : 'qwen2.5:14b',
      },
    },
    escalation: {
      levels: [
        { level: 1, name: 'ollama-local', model: 'qwen2.5:14b', use_for: ['tier1', 'tier2'] },
        { level: 2, name: 'claude-api', model: 'claude-sonnet-4-20250514', use_for: ['tier2'] },
        { level: 3, name: 'human', use_for: ['tier3'] },
      ],
    },
    task_assignment: {
      auto_assign: autoAssignMatch ? autoAssignMatch[1] === 'true' : true,
      max_tasks_per_worker: maxTasksMatch ? parseInt(maxTasksMatch[1]) : 1,
      unassigned_alert_minutes: unassignedAlertMatch ? parseInt(unassignedAlertMatch[1]) : 15,
    },
    loop: {
      interval_minutes: intervalMatch ? parseInt(intervalMatch[1]) : 5,
      digest_interval_hours: digestMatch ? parseInt(digestMatch[1]) : 8,
    },
  };
}
