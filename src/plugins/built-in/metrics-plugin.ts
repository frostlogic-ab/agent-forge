import {
  Plugin,
  type PluginHookData,
  PluginLifecycleHooks,
} from "../plugin-manager";

export interface PluginMetrics {
  agentRuns: number;
  totalExecutionTime: number;
  toolCalls: number;
  errors: number;
  tokenUsage: { prompt: number; completion: number };
  lastResetTime: number;
}

export class MetricsPlugin extends Plugin {
  readonly name = "metrics";
  readonly version = "1.0.0";

  private metrics: PluginMetrics = {
    agentRuns: 0,
    totalExecutionTime: 0,
    toolCalls: 0,
    errors: 0,
    tokenUsage: { prompt: 0, completion: 0 },
    lastResetTime: Date.now(),
  };

  getHooks() {
    return {
      [PluginLifecycleHooks.AGENT_AFTER_RUN]:
        this.recordAgentMetrics.bind(this),
      [PluginLifecycleHooks.TOOL_AFTER_EXECUTE]:
        this.recordToolMetrics.bind(this),
      [PluginLifecycleHooks.AGENT_ERROR]: this.recordError.bind(this),
    };
  }

  private recordAgentMetrics(data: PluginHookData): void {
    const { result } = data.payload;
    this.metrics.agentRuns++;

    // Defensive programming - handle missing metadata
    if (result?.metadata) {
      if (typeof result.metadata.executionTime === "number") {
        this.metrics.totalExecutionTime += result.metadata.executionTime;
      } else {
        this.log(
          `Agent execution time missing or invalid: ${result.metadata.executionTime}`,
          "warn"
        );
      }

      if (result.metadata.tokenUsage) {
        if (typeof result.metadata.tokenUsage.prompt === "number") {
          this.metrics.tokenUsage.prompt += result.metadata.tokenUsage.prompt;
        }
        if (typeof result.metadata.tokenUsage.completion === "number") {
          this.metrics.tokenUsage.completion +=
            result.metadata.tokenUsage.completion;
        }
      }
    } else {
      this.log("Agent result or metadata missing for agent run", "warn");
    }

    this.log(`Recorded agent run. Total runs: ${this.metrics.agentRuns}`);
  }

  private recordToolMetrics(_data: PluginHookData): void {
    this.metrics.toolCalls++;
  }

  private recordError(_data: PluginHookData): void {
    this.metrics.errors++;
  }

  getMetrics(): PluginMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      agentRuns: 0,
      totalExecutionTime: 0,
      toolCalls: 0,
      errors: 0,
      tokenUsage: { prompt: 0, completion: 0 },
      lastResetTime: Date.now(),
    };
  }

  getAverageExecutionTime(): number {
    return this.metrics.agentRuns > 0
      ? this.metrics.totalExecutionTime / this.metrics.agentRuns
      : 0;
  }

  getTotalTokens(): number {
    return this.metrics.tokenUsage.prompt + this.metrics.tokenUsage.completion;
  }
}
