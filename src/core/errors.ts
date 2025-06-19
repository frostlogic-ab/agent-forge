/**
 * Base error class for all Agent Forge errors
 */
export class AgentForgeError extends Error {
  public readonly code: string;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly timestamp: number;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code = "AGENT_FORGE_ERROR",
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    context: Partial<ErrorContext> = {},
    recoverable = false
  ) {
    super(message);
    this.name = "AgentForgeError";
    this.code = code;
    this.severity = severity;
    this.context = { agentName: null, model: null, toolName: null, ...context };
    this.timestamp = Date.now();
    this.recoverable = recoverable;

    // Ensure stack trace is captured
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to a structured log object
   */
  toLogObject(): ErrorLogObject {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }
}

/**
 * LLM connection and communication errors
 */
export class LLMConnectionError extends AgentForgeError {
  constructor(
    message: string,
    model?: string,
    context: Partial<ErrorContext> = {}
  ) {
    super(
      message,
      "LLM_CONNECTION_ERROR",
      ErrorSeverity.ERROR,
      { model, ...context },
      true // Usually recoverable with retry
    );
    this.name = "LLMConnectionError";
  }
}

/**
 * Tool execution errors
 */
export class ToolExecutionError extends AgentForgeError {
  public readonly toolName: string;
  public readonly parameters: any;

  constructor(
    message: string,
    toolName: string,
    parameters?: any,
    context: Partial<ErrorContext> = {}
  ) {
    super(
      message,
      "TOOL_EXECUTION_ERROR",
      ErrorSeverity.ERROR,
      { toolName, ...context },
      true // Tool errors are usually recoverable
    );
    this.name = "ToolExecutionError";
    this.toolName = toolName;
    this.parameters = parameters;
  }
}

/**
 * Agent configuration errors
 */
export class AgentConfigurationError extends AgentForgeError {
  constructor(message: string, context: Partial<ErrorContext> = {}) {
    super(
      message,
      "AGENT_CONFIGURATION_ERROR",
      ErrorSeverity.CRITICAL,
      context,
      false // Configuration errors are usually not recoverable
    );
    this.name = "AgentConfigurationError";
  }
}

/**
 * Plugin errors
 */
export class PluginError extends AgentForgeError {
  public readonly pluginName: string;
  public readonly phase: string;

  constructor(
    message: string,
    pluginName: string,
    phase = "unknown",
    context: Partial<ErrorContext> = {}
  ) {
    super(message, "PLUGIN_ERROR", ErrorSeverity.WARNING, { ...context }, true);
    this.name = "PluginError";
    this.pluginName = pluginName;
    this.phase = phase;
  }
}

/**
 * Tool configuration errors
 */
export class ToolConfigurationError extends AgentForgeError {
  constructor(
    message: string,
    toolName?: string,
    context: Partial<ErrorContext> = {}
  ) {
    super(
      message,
      "TOOL_CONFIGURATION_ERROR",
      ErrorSeverity.ERROR,
      { toolName, ...context },
      false
    );
    this.name = "ToolConfigurationError";
  }
}

/**
 * Agent execution timeout errors
 */
export class AgentTimeoutError extends AgentForgeError {
  public readonly timeoutMs: number;
  public readonly executionTimeMs: number;

  constructor(
    message: string,
    timeoutMs: number,
    executionTimeMs: number,
    context: Partial<ErrorContext> = {}
  ) {
    super(
      message,
      "AGENT_TIMEOUT_ERROR",
      ErrorSeverity.WARNING,
      context,
      false // Timeouts are usually not recoverable in the current execution
    );
    this.name = "AgentTimeoutError";
    this.timeoutMs = timeoutMs;
    this.executionTimeMs = executionTimeMs;
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends AgentForgeError {
  public readonly retryAfter?: number;
  public readonly limit?: number;

  constructor(
    message: string,
    retryAfter?: number,
    limit?: number,
    context: Partial<ErrorContext> = {}
  ) {
    super(
      message,
      "RATE_LIMIT_ERROR",
      ErrorSeverity.WARNING,
      context,
      true // Rate limits are recoverable with retry
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.limit = limit;
  }
}

/**
 * LLM response parsing errors
 */
export class LLMResponseError extends AgentForgeError {
  public readonly response: any;

  constructor(
    message: string,
    response: any,
    context: Partial<ErrorContext> = {}
  ) {
    super(
      message,
      "LLM_RESPONSE_ERROR",
      ErrorSeverity.ERROR,
      context,
      true // Response errors might be recoverable with retry
    );
    this.name = "LLMResponseError";
    this.response = response;
  }
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  DEBUG = "debug",
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

/**
 * Error context information
 */
export interface ErrorContext {
  agentName: string | null;
  model: string | null;
  toolName: string | null;
  conversationLength?: number;
  executionTime?: number;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  additionalData?: Record<string, any>;
}

/**
 * Structured error log object
 */
export interface ErrorLogObject {
  name: string;
  code: string;
  message: string;
  severity: ErrorSeverity;
  context: ErrorContext;
  timestamp: number;
  recoverable: boolean;
  stack?: string;
}

/**
 * Error recovery strategy
 */
export interface ErrorRecoveryStrategy {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  shouldRetry: (error: AgentForgeError, attemptNumber: number) => boolean;
}

/**
 * Default error recovery strategies
 */
export const DEFAULT_RECOVERY_STRATEGIES: Record<
  string,
  ErrorRecoveryStrategy
> = {
  LLM_CONNECTION_ERROR: {
    maxRetries: 3,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
    shouldRetry: (error, attempt) => error.recoverable && attempt < 3,
  },
  RATE_LIMIT_ERROR: {
    maxRetries: 5,
    retryDelayMs: 2000,
    backoffMultiplier: 1.5,
    shouldRetry: (error, attempt) => error.recoverable && attempt < 5,
  },
  TOOL_EXECUTION_ERROR: {
    maxRetries: 2,
    retryDelayMs: 500,
    backoffMultiplier: 1,
    shouldRetry: (error, attempt) => error.recoverable && attempt < 2,
  },
};
