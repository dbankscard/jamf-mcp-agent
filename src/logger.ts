import { getRequestId } from './context.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

const configuredLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const isTTY = process.stdout.isTTY ?? false;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel];
}

function formatTTY(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  const color = LEVEL_COLORS[level];
  const ts = new Date().toISOString().slice(11, 23);
  const requestId = getRequestId();
  const rid = requestId ? ` [${requestId.slice(0, 8)}]` : '';
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `${color}${ts} ${level.toUpperCase().padEnd(5)}${RESET}${rid} ${msg}${metaStr}`;
}

function formatJSON(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
  };
  const requestId = getRequestId();
  if (requestId) entry.requestId = requestId;
  if (meta) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const line = isTTY ? formatTTY(level, msg, meta) : formatJSON(level, msg, meta);

  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
