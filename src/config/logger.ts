import { config } from './index';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(entry: LogEntry): string {
  if (config.app.env === 'production') {
    return JSON.stringify(entry);
  }

  const { timestamp, level, message, data, error } = entry;
  let output = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (data && Object.keys(data).length > 0) {
    output += ` ${JSON.stringify(data)}`;
  }

  if (error) {
    output += `\n  Error: ${error.name}: ${error.message}`;
    if (error.stack) {
      output += `\n  Stack: ${error.stack}`;
    }
  }

  return output;
}

function createLogEntry(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: config.app.serviceName,
    message,
  };

  if (data) {
    entry.data = data;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return entry;
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.debug(formatLog(createLogEntry('debug', message, data)));
    }
  },

  info(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.info(formatLog(createLogEntry('info', message, data)));
    }
  },

  warn(message: string, data?: Record<string, unknown>, error?: Error): void {
    if (shouldLog('warn')) {
      console.warn(formatLog(createLogEntry('warn', message, data, error)));
    }
  },

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatLog(createLogEntry('error', message, data, error)));
    }
  },
};

export default logger;
