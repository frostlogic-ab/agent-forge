import { logger } from "./agent-logger";
import type { AgentForgeError, ErrorRecoveryStrategy } from "./errors";
import { DEFAULT_RECOVERY_STRATEGIES } from "./errors";

/**
 * Error recovery utility with retry logic and exponential backoff
 */
export const ErrorRecovery = {
  recoveryStrategies: new Map<string, ErrorRecoveryStrategy>(),
  circuitBreakers: new Map<string, CircuitBreaker>(),

  /**
   * Initialize with default recovery strategies
   */
  init(): void {
    Object.entries(DEFAULT_RECOVERY_STRATEGIES).forEach(
      ([errorCode, strategy]) => {
        this.recoveryStrategies.set(errorCode, strategy);
      }
    );
  },

  /**
   * Register a custom recovery strategy for an error code
   */
  registerStrategy(errorCode: string, strategy: ErrorRecoveryStrategy): void {
    this.recoveryStrategies.set(errorCode, strategy);
  },

  /**
   * Get recovery strategy for an error code
   */
  getStrategy(errorCode: string): ErrorRecoveryStrategy | undefined {
    return this.recoveryStrategies.get(errorCode);
  },

  /**
   * Execute an operation with automatic retry on recoverable errors
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    context: {
      agentName?: string;
      operationName: string;
      customStrategy?: ErrorRecoveryStrategy;
    }
  ): Promise<T> {
    let attemptNumber = 0;

    while (true) {
      attemptNumber++;

      try {
        logger.debug(
          `Executing operation: ${context.operationName} (attempt ${attemptNumber})`,
          context.agentName
        );

        const result = await operation();

        if (attemptNumber > 1) {
          logger.info(
            `Operation succeeded after ${attemptNumber} attempts: ${context.operationName}`,
            context.agentName
          );
        }

        return result;
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error; // Re-throw non-Error objects
        }

        const agentError = error as AgentForgeError;

        // Get recovery strategy
        const strategy =
          context.customStrategy ||
          (agentError.code ? this.getStrategy(agentError.code) : undefined);

        if (!strategy) {
          logger.error(
            `No recovery strategy for error: ${agentError.name}`,
            context.agentName,
            { operationName: context.operationName, attemptNumber },
            agentError
          );
          throw error;
        }

        // Check if we should retry
        if (
          !strategy.shouldRetry(agentError, attemptNumber) ||
          attemptNumber >= strategy.maxRetries
        ) {
          logger.error(
            `Operation failed after ${attemptNumber} attempts: ${context.operationName}`,
            context.agentName,
            {
              operationName: context.operationName,
              maxRetries: strategy.maxRetries,
            },
            agentError
          );
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay =
          strategy.retryDelayMs *
          strategy.backoffMultiplier ** (attemptNumber - 1);

        logger.warn(
          `Operation failed, retrying in ${delay}ms: ${context.operationName}`,
          context.agentName,
          {
            operationName: context.operationName,
            attemptNumber,
            nextRetryIn: `${delay}ms`,
            errorCode: agentError.code,
          }
        );

        // Wait before retry
        await waitFor(delay);
      }
    }
  },

  /**
   * Execute an operation with circuit breaker pattern
   */
  async withCircuitBreaker<T>(
    operation: () => Promise<T>,
    context: {
      agentName?: string;
      operationName: string;
      failureThreshold?: number;
      resetTimeoutMs?: number;
    }
  ): Promise<T> {
    const breakerKey = `${context.agentName || "global"}:${context.operationName}`;
    let breaker = this.circuitBreakers.get(breakerKey);

    if (!breaker) {
      breaker = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        threshold: context.failureThreshold || 5,
        resetTimeout: context.resetTimeoutMs || 60000,
      };
      this.circuitBreakers.set(breakerKey, breaker);
    }

    // Check circuit breaker state
    const now = Date.now();

    if (breaker.state === CircuitBreakerState.OPEN) {
      if (now - breaker.lastFailureTime > breaker.resetTimeout) {
        breaker.state = CircuitBreakerState.HALF_OPEN;
        logger.info(
          `Circuit breaker transitioning to HALF_OPEN: ${context.operationName}`,
          context.agentName
        );
      } else {
        const error = new Error(
          `Circuit breaker is OPEN for operation: ${context.operationName}`
        );
        logger.warn(
          `Circuit breaker blocking operation: ${context.operationName}`,
          context.agentName,
          { state: breaker.state, failureCount: breaker.failureCount }
        );
        throw error;
      }
    }

    try {
      const result = await operation();

      // Reset on success
      if (breaker.state === CircuitBreakerState.HALF_OPEN) {
        breaker.state = CircuitBreakerState.CLOSED;
        breaker.failureCount = 0;
        logger.info(
          `Circuit breaker reset to CLOSED: ${context.operationName}`,
          context.agentName
        );
      }

      return result;
    } catch (error) {
      breaker.failureCount++;
      breaker.lastFailureTime = now;

      if (breaker.failureCount >= breaker.threshold) {
        breaker.state = CircuitBreakerState.OPEN;
        logger.warn(
          `Circuit breaker OPENED due to failures: ${context.operationName}`,
          context.agentName,
          { failureCount: breaker.failureCount, threshold: breaker.threshold }
        );
      }

      throw error;
    }
  },
};

// Initialize recovery strategies
ErrorRecovery.init();

/**
 * Delay execution for specified milliseconds
 */
function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Circuit breaker states
 */
enum CircuitBreakerState {
  CLOSED = "closed", // Normal operation
  OPEN = "open", // Blocking requests
  HALF_OPEN = "half_open", // Testing if service is back
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreaker {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
  threshold: number;
  resetTimeout: number;
}

/**
 * Error analysis utilities
 */
export const ErrorAnalyzer = {
  /**
   * Analyze error and suggest recovery actions
   */
  analyzeError(error: AgentForgeError): ErrorAnalysisResult {
    const analysis: ErrorAnalysisResult = {
      errorCode: error.code,
      severity: error.severity,
      recoverable: error.recoverable,
      suggestedActions: [],
      debugInfo: {
        timestamp: error.timestamp,
        context: error.context,
        stack: error.stack,
      },
    };

    // Analyze based on error code
    switch (error.code) {
      case "LLM_CONNECTION_ERROR":
        analysis.suggestedActions = [
          "Check network connectivity",
          "Verify API key and credentials",
          "Check service status of LLM provider",
          "Consider fallback to different model",
        ];
        break;

      case "RATE_LIMIT_ERROR":
        analysis.suggestedActions = [
          "Implement request queuing",
          "Add delays between requests",
          "Consider upgrading API plan",
          "Use different API key or endpoint",
        ];
        break;

      case "TOOL_EXECUTION_ERROR":
        analysis.suggestedActions = [
          "Validate tool parameters",
          "Check tool availability",
          "Review tool configuration",
          "Consider alternative tools",
        ];
        break;

      case "AGENT_TIMEOUT_ERROR":
        analysis.suggestedActions = [
          "Increase timeout duration",
          "Optimize agent processing",
          "Break down complex tasks",
          "Implement task cancellation",
        ];
        break;

      case "AGENT_CONFIGURATION_ERROR":
        analysis.suggestedActions = [
          "Review agent configuration",
          "Check required fields",
          "Validate configuration format",
          "Use configuration validator",
        ];
        break;

      default:
        analysis.suggestedActions = [
          "Review error details",
          "Check logs for context",
          "Verify system state",
          "Contact support if needed",
        ];
    }

    return analysis;
  },

  /**
   * Get error trends and patterns
   */
  getErrorTrends(): ErrorTrends {
    const recentErrors = logger.getErrorLogs(100);

    const trends: ErrorTrends = {
      totalErrors: recentErrors.length,
      errorsByCode: {},
      errorsByAgent: {},
      recentSpike: false,
      patterns: [],
    };

    // Count errors by code
    recentErrors.forEach((entry) => {
      if (entry.error) {
        trends.errorsByCode[entry.error.code] =
          (trends.errorsByCode[entry.error.code] || 0) + 1;

        if (entry.agentName) {
          trends.errorsByAgent[entry.agentName] =
            (trends.errorsByAgent[entry.agentName] || 0) + 1;
        }
      }
    });

    // Detect recent spikes
    const recentHour = Date.now() - 60 * 60 * 1000;
    const recentErrorCount = recentErrors.filter(
      (entry) => entry.timestamp > recentHour
    ).length;
    trends.recentSpike = recentErrorCount > 10; // Configurable threshold

    // Identify patterns
    const topErrorCode = Object.entries(trends.errorsByCode).sort(
      ([, a], [, b]) => b - a
    )[0];

    if (topErrorCode && topErrorCode[1] > 5) {
      trends.patterns.push(
        `High frequency of ${topErrorCode[0]} errors (${topErrorCode[1]} occurrences)`
      );
    }

    return trends;
  },
};

/**
 * Error analysis result
 */
export interface ErrorAnalysisResult {
  errorCode: string;
  severity: string;
  recoverable: boolean;
  suggestedActions: string[];
  debugInfo: {
    timestamp: number;
    context: any;
    stack?: string;
  };
}

/**
 * Error trends information
 */
export interface ErrorTrends {
  totalErrors: number;
  errorsByCode: Record<string, number>;
  errorsByAgent: Record<string, number>;
  recentSpike: boolean;
  patterns: string[];
}
