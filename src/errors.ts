export type ErrorComponent = 'mcp' | 'bedrock' | 'slack' | 'config' | 'scheduler';

export class AppError extends Error {
  readonly component: ErrorComponent;
  readonly operation: string;
  readonly context: Record<string, unknown>;
  override readonly cause?: Error;

  constructor(
    message: string,
    opts: {
      component: ErrorComponent;
      operation: string;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.component = opts.component;
    this.operation = opts.operation;
    this.context = opts.context ?? {};
    this.cause = opts.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      component: this.component,
      operation: this.operation,
      context: this.context,
      cause: this.cause
        ? { name: this.cause.name, message: this.cause.message }
        : undefined,
      stack: this.stack,
    };
  }
}

export class MCPError extends AppError {
  constructor(
    message: string,
    opts: { operation: string; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, { component: 'mcp', ...opts });
    this.name = 'MCPError';
  }
}

export class BedrockError extends AppError {
  constructor(
    message: string,
    opts: { operation: string; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, { component: 'bedrock', ...opts });
    this.name = 'BedrockError';
  }
}

export class SlackError extends AppError {
  constructor(
    message: string,
    opts: { operation: string; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, { component: 'slack', ...opts });
    this.name = 'SlackError';
  }
}

export class ConfigError extends AppError {
  constructor(
    message: string,
    opts: { context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, { component: 'config', operation: 'load', ...opts });
    this.name = 'ConfigError';
  }
}

export class TimeoutError extends AppError {
  readonly timeoutMs: number;

  constructor(
    message: string,
    opts: {
      component: ErrorComponent;
      operation: string;
      timeoutMs: number;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, opts);
    this.name = 'TimeoutError';
    this.timeoutMs = opts.timeoutMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      timeoutMs: this.timeoutMs,
    };
  }
}
