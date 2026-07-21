type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  const current = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'info'] ?? 1;
  return LOG_LEVELS[level] >= current;
}

function formatMessage(level: LogLevel, message: string, meta?: any): string {
  const ts = new Date().toISOString();
  const metaStr = meta !== undefined ? ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  info: (message: string, meta?: any) => {
    if (shouldLog('info')) console.log(formatMessage('info', message, meta));
  },
  warn: (message: string, meta?: any) => {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message, meta));
  },
  error: (message: string, meta?: any) => {
    if (shouldLog('error')) console.error(formatMessage('error', message, meta));
  },
  debug: (message: string, meta?: any) => {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message, meta));
  }
};
