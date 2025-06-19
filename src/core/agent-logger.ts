import { AgentForgeEvents } from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import type { AgentForgeError, ErrorLogObject, ErrorSeverity } from "./errors";

/**
 * Log levels for agent operations
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
  CRITICAL = 4,
}

/**
 * Structured log entry
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  agentName?: string;
  context?: Record<string, any>;
  error?: ErrorLogObject;
  executionTime?: number;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  level: LogLevel;
  enableConsoleLogging: boolean;
  enableEventEmission: boolean;
  enablePerformanceLogging: boolean;
  enableErrorAggregation: boolean;
  maxLogHistory: number;
}

/**
 * Centralized logger for Agent operations
 */
export class AgentLogger {
  private static instance: AgentLogger;
  private config: LoggerConfig;
  private logHistory: LogEntry[] = [];
  private errorCounts: Map<string, number> = new Map();
  private performanceMetrics: Map<string, PerformanceMetric> = new Map();

  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableConsoleLogging: true,
      enableEventEmission: true,
      enablePerformanceLogging: true,
      enableErrorAggregation: true,
      maxLogHistory: 1000,
      ...config,
    };
  }

  /**
   * Get or create the singleton logger instance
   */
  static getInstance(config?: Partial<LoggerConfig>): AgentLogger {
    if (!AgentLogger.instance) {
      AgentLogger.instance = new AgentLogger(config);
    }
    return AgentLogger.instance;
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Log debug information
   */
  debug(
    message: string,
    agentName?: string,
    context?: Record<string, any>
  ): void {
    this.log(LogLevel.DEBUG, message, agentName, context);
  }

  /**
   * Log informational messages
   */
  info(
    message: string,
    agentName?: string,
    context?: Record<string, any>
  ): void {
    this.log(LogLevel.INFO, message, agentName, context);
  }

  /**
   * Log warnings
   */
  warn(
    message: string,
    agentName?: string,
    context?: Record<string, any>
  ): void {
    this.log(LogLevel.WARNING, message, agentName, context);
  }

  /**
   * Log errors
   */
  error(
    message: string,
    agentName?: string,
    context?: Record<string, any>,
    error?: AgentForgeError
  ): void {
    const entry = this.createLogEntry(
      LogLevel.ERROR,
      message,
      agentName,
      context
    );

    if (error) {
      entry.error = error.toLogObject();

      // Aggregate error counts
      if (this.config.enableErrorAggregation) {
        const errorKey = `${error.code}:${agentName || "unknown"}`;
        this.errorCounts.set(
          errorKey,
          (this.errorCounts.get(errorKey) || 0) + 1
        );
      }
    }

    this.processLogEntry(entry);
  }

  /**
   * Log critical errors
   */
  critical(
    message: string,
    agentName?: string,
    context?: Record<string, any>,
    error?: AgentForgeError
  ): void {
    const entry = this.createLogEntry(
      LogLevel.CRITICAL,
      message,
      agentName,
      context
    );

    if (error) {
      entry.error = error.toLogObject();

      // Aggregate error counts
      if (this.config.enableErrorAggregation) {
        const errorKey = `${error.code}:${agentName || "unknown"}`;
        this.errorCounts.set(
          errorKey,
          (this.errorCounts.get(errorKey) || 0) + 1
        );
      }
    }

    this.processLogEntry(entry);
  }

  /**
   * Log agent execution start
   */
  logExecutionStart(
    agentName: string,
    input: string,
    context?: Record<string, any>
  ): string {
    const executionId = `${agentName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.info(
      `Agent execution started: ${input.substring(0, 100)}${input.length > 100 ? "..." : ""}`,
      agentName,
      { ...context, executionId, inputLength: input.length }
    );

    // Start performance tracking
    if (this.config.enablePerformanceLogging) {
      this.performanceMetrics.set(executionId, {
        agentName,
        startTime: Date.now(),
        phase: "execution",
      });
    }

    return executionId;
  }

  /**
   * Log agent execution completion
   */
  logExecutionComplete(
    executionId: string,
    agentName: string,
    result: string,
    tokenUsage?: { prompt: number; completion: number; total: number },
    context?: Record<string, any>
  ): void {
    let executionTime: number | undefined;

    // Calculate execution time
    if (this.config.enablePerformanceLogging) {
      const metric = this.performanceMetrics.get(executionId);
      if (metric) {
        executionTime = Date.now() - metric.startTime;
        this.performanceMetrics.delete(executionId);
      }
    }

    this.info(
      `Agent execution completed: ${result.substring(0, 100)}${result.length > 100 ? "..." : ""}`,
      agentName,
      {
        ...context,
        executionId,
        resultLength: result.length,
        executionTime: executionTime ? `${executionTime}ms` : undefined,
        tokenUsage,
      }
    );
  }

  /**
   * Log tool execution
   */
  logToolExecution(
    agentName: string,
    toolName: string,
    parameters: any,
    result?: any,
    error?: AgentForgeError,
    executionTime?: number
  ): void {
    const message = error
      ? `Tool execution failed: ${toolName}`
      : `Tool execution completed: ${toolName}`;

    const context = {
      toolName,
      parameters: JSON.stringify(parameters).substring(0, 500),
      resultSize: result ? JSON.stringify(result).length : 0,
      executionTime: executionTime ? `${executionTime}ms` : undefined,
    };

    if (error) {
      this.error(message, agentName, context, error);
    } else {
      this.debug(message, agentName, context);
    }
  }

  /**
   * Log LLM interactions
   */
  logLLMInteraction(
    agentName: string,
    model: string,
    tokenUsage?: { prompt: number; completion: number; total: number },
    executionTime?: number,
    error?: AgentForgeError
  ): void {
    const message = error
      ? `LLM interaction failed for model: ${model}`
      : `LLM interaction completed for model: ${model}`;

    const context = {
      model,
      tokenUsage,
      executionTime: executionTime ? `${executionTime}ms` : undefined,
    };

    if (error) {
      this.error(message, agentName, context, error);
    } else {
      this.info(message, agentName, context);
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats(): Record<string, number> {
    return Object.fromEntries(this.errorCounts);
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count = 50): LogEntry[] {
    return this.logHistory.slice(-count);
  }

  /**
   * Get logs filtered by agent name
   */
  getAgentLogs(agentName: string, count = 50): LogEntry[] {
    return this.logHistory
      .filter((entry) => entry.agentName === agentName)
      .slice(-count);
  }

  /**
   * Get logs filtered by error level
   */
  getErrorLogs(count = 50): LogEntry[] {
    return this.logHistory
      .filter((entry) => entry.level >= LogLevel.ERROR)
      .slice(-count);
  }

  /**
   * Clear log history
   */
  clearLogs(): void {
    this.logHistory = [];
    this.errorCounts.clear();
    this.performanceMetrics.clear();
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(
      {
        logs: this.logHistory,
        errorStats: Object.fromEntries(this.errorCounts),
        exportTime: new Date().toISOString(),
      },
      null,
      2
    );
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    agentName?: string,
    context?: Record<string, any>
  ): void {
    if (level < this.config.level) {
      return; // Skip if below configured log level
    }

    const entry = this.createLogEntry(level, message, agentName, context);
    this.processLogEntry(entry);
  }

  /**
   * Create a structured log entry
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    agentName?: string,
    context?: Record<string, any>
  ): LogEntry {
    return {
      level,
      message,
      timestamp: Date.now(),
      agentName,
      context,
    };
  }

  /**
   * Process and output a log entry
   */
  private processLogEntry(entry: LogEntry): void {
    // Add to history
    this.logHistory.push(entry);

    // Maintain history size limit
    if (this.logHistory.length > this.config.maxLogHistory) {
      this.logHistory = this.logHistory.slice(-this.config.maxLogHistory);
    }

    // Console logging
    if (this.config.enableConsoleLogging) {
      this.outputToConsole(entry);
    }

    // Event emission
    if (this.config.enableEventEmission) {
      globalEventEmitter.emit(AgentForgeEvents.AGENT_LOG, entry);
    }
  }

  /**
   * Output log entry to console
   */
  private outputToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const agentPrefix = entry.agentName ? `[${entry.agentName}] ` : "";
    const levelName = LogLevel[entry.level].padEnd(8);

    let consoleMessage = `${timestamp} ${levelName} ${agentPrefix}${entry.message}`;

    // Add context if present
    if (entry.context && Object.keys(entry.context).length > 0) {
      consoleMessage += ` | Context: ${JSON.stringify(entry.context)}`;
    }

    // Add error details if present
    if (entry.error) {
      consoleMessage += ` | Error: ${entry.error.code} - ${entry.error.message}`;
    }

    // Use appropriate console method based on log level
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(consoleMessage);
        break;
      case LogLevel.INFO:
        console.info(consoleMessage);
        break;
      case LogLevel.WARNING:
        console.warn(consoleMessage);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(consoleMessage);
        if (entry.error?.stack) {
          console.error("Stack trace:", entry.error.stack);
        }
        break;
    }
  }
}

/**
 * Performance metric tracking
 */
interface PerformanceMetric {
  agentName: string;
  startTime: number;
  phase: string;
}

/**
 * Create a default logger instance
 */
export const logger = AgentLogger.getInstance();
