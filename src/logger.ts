/**
 * Structured logging utility with log levels, timestamps, and metadata support.
 */

// ---------------------------------------------------------------------------
// Log Levels
// ---------------------------------------------------------------------------

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

// Log level priority for filtering
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

// ---------------------------------------------------------------------------
// Logger Options
// ---------------------------------------------------------------------------

export interface LoggerOptions {
  /** Minimum log level to output (default: info) */
  minLevel?: LogLevel;
  /** Whether to include timestamp in output (default: true) */
  timestamp?: boolean;
  /** Whether to include log level in output (default: true) */
  level?: boolean;
  /** Custom timestamp format function */
  formatTimestamp?: (date: Date) => string;
}

// ---------------------------------------------------------------------------
// Logger Entry
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Logger Class
// ---------------------------------------------------------------------------

export class Logger {
  private minLevel: LogLevel;
  private includeTimestamp: boolean;
  private includeLevel: boolean;
  private formatTimestamp: (date: Date) => string;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? LogLevel.INFO;
    this.includeTimestamp = options.timestamp ?? true;
    this.includeLevel = options.level ?? true;
    this.formatTimestamp =
      options.formatTimestamp ??
      ((date: Date) => date.toISOString());
  }

  /**
   * Check if a log level should be output based on current minimum level
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * Format a log entry for output
   */
  private format(entry: LogEntry): string {
    const parts: string[] = [];

    if (this.includeTimestamp) {
      parts.push(entry.timestamp);
    }

    if (this.includeLevel) {
      parts.push(`[${entry.level.toUpperCase()}]`);
    }

    parts.push(entry.message);

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      parts.push(JSON.stringify(entry.metadata));
    }

    return parts.join(" ");
  }

  /**
   * Create a log entry and output it
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: this.formatTimestamp(new Date()),
      metadata,
    };

    const formatted = this.format(entry);

    // Output based on level
    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
        console.error(formatted);
        break;
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log an info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log a warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log an error message
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, metadata);
  }

  /**
   * Log an error with stack trace
   */
  errorWithStack(error: Error, metadata?: Record<string, unknown>): void {
    const fullMetadata = {
      ...metadata,
      stack: error.stack,
    };
    this.log(LogLevel.ERROR, error.message, fullMetadata);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    return new Logger({
      minLevel: this.minLevel,
      timestamp: this.includeTimestamp,
      level: this.includeLevel,
      formatTimestamp: this.formatTimestamp,
    });
  }
}

// ---------------------------------------------------------------------------
// Default Logger Instance
// ---------------------------------------------------------------------------

/**
 * Default logger instance for application-wide use
 */
export const logger = new Logger();

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Create a new logger with custom options
 */
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}
