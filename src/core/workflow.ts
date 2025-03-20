import { AgentForgeEvents, type AgentResult } from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { enableConsoleStreaming } from "../utils/streaming";
import type { Agent, AgentRunOptions } from "./agent";

/**
 * Options for running a workflow
 */
export interface WorkflowRunOptions {
  /**
   * Maximum number of LLM calls allowed per minute (default: no limit)
   * Used to prevent hitting API rate limits
   */
  rate_limit?: number;

  /**
   * Enable detailed logging of workflow execution (default: false)
   * Useful for debugging workflow steps
   */
  verbose?: boolean;

  /**
   * Enable streaming of agent communications (default: false)
   */
  stream?: boolean;

  /**
   * Enable console streaming (default: false)
   */
  enableConsoleStream?: boolean;
}

/**
 * Represents a step in a workflow
 */
interface WorkflowStep {
  agent: Agent;
  inputTransform?: (input: string, previousResults: AgentResult[]) => string;
}

/**
 * Workflow for sequential execution of agents
 */
export class Workflow {
  private steps: WorkflowStep[] = [];
  private name: string;
  private description: string;
  private rateLimiter?: {
    tokensRemaining: number;
    lastResetTime: number;
    waitingQueue: Array<() => void>;
  };
  private verbose = false;

  /**
   * Creates a new workflow
   * @param name Name of the workflow
   * @param description Description of the workflow
   */
  constructor(name = "Workflow", description = "A sequence of agents") {
    this.name = name;
    this.description = description;
  }

  /**
   * Sets the name of the workflow
   * @param name The new name
   * @returns The workflow instance for method chaining
   */
  setName(name: string): Workflow {
    this.name = name;
    return this;
  }

  /**
   * Sets the description of the workflow
   * @param description The new description
   * @returns The workflow instance for method chaining
   */
  setDescription(description: string): Workflow {
    this.description = description;
    return this;
  }

  /**
   * Gets the name of the workflow
   */
  getName(): string {
    return this.name;
  }

  /**
   * Gets the description of the workflow
   */
  getDescription(): string {
    return this.description;
  }

  /**
   * Adds a step to the workflow
   * @param agent The agent to execute in this step
   * @param inputTransform Optional function to transform the input for this step
   * @returns The workflow instance for method chaining
   */
  addStep(
    agent: Agent,
    inputTransform?: (input: string, previousResults: AgentResult[]) => string
  ): Workflow {
    this.steps.push({
      agent,
      inputTransform,
    });
    return this;
  }

  /**
   * Gets all steps in the workflow
   * @returns Array of workflow steps
   */
  getSteps(): WorkflowStep[] {
    return [...this.steps];
  }

  /**
   * Runs the workflow with the given input
   * @param input The initial input to the workflow
   * @param options Optional settings for workflow execution
   * @returns The result of the last agent in the workflow
   */
  async run(input: string, options?: WorkflowRunOptions): Promise<AgentResult> {
    if (this.steps.length === 0) {
      throw new Error("Workflow has no steps");
    }

    this.reset();
    this.initializeOptions(options);

    try {
      this.logWorkflowStart(input);

      const results = await this.executeWorkflowSteps(
        input,
        options?.stream || false
      );

      this.logWorkflowCompletion();
      return results[results.length - 1];
    } finally {
      this.rateLimiter = undefined;
    }
  }

  /**
   * Initialize workflow options
   */
  private initializeOptions(options?: WorkflowRunOptions): void {
    this.verbose = options?.verbose || false;

    // Initialize console streaming if requested
    if (options?.stream && options?.enableConsoleStream) {
      enableConsoleStreaming();
    }

    // Initialize rate limiter if needed
    if (options?.rate_limit) {
      this.setupRateLimiter(options.rate_limit);
    }
  }

  /**
   * Execute all workflow steps sequentially
   */
  private async executeWorkflowSteps(
    input: string,
    stream: boolean
  ): Promise<AgentResult[]> {
    let currentInput = input;
    const results: AgentResult[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const result = await this.executeWorkflowStep(
        i,
        currentInput,
        results,
        stream
      );
      results.push(result);
      currentInput = result.output;
    }

    // If streaming is enabled, emit a completion event
    if (stream) {
      globalEventEmitter.emit(AgentForgeEvents.EXECUTION_COMPLETE, {
        type: "workflow",
        name: this.name,
        result: results[results.length - 1],
      });
    }

    return results;
  }

  /**
   * Execute a single workflow step
   */
  private async executeWorkflowStep(
    stepIndex: number,
    currentInput: string,
    previousResults: AgentResult[],
    stream: boolean
  ): Promise<AgentResult> {
    const step = this.steps[stepIndex];
    const agent = step.agent;

    this.logStepStart(stepIndex, agent);

    // Transform the input if a transform function is provided
    let inputForAgent = currentInput;
    if (step.inputTransform && stepIndex > 0) {
      inputForAgent = step.inputTransform(currentInput, previousResults);
      this.logInputTransformation(inputForAgent);
    }

    // Emit pre-step event if streaming
    this.emitStepStartEvent(stream, stepIndex, agent, inputForAgent);

    // Execute the agent
    const startTime = Date.now();
    const result = await agent.run(inputForAgent, {
      stream,
      maxTurns: undefined, // Use agent default
    });
    const duration = Date.now() - startTime;

    this.logStepCompletion(stepIndex, duration, result);
    this.emitStepCompleteEvent(stream, stepIndex, agent, result, duration);

    return result;
  }

  /**
   * Emit event when a step is about to start
   */
  private emitStepStartEvent(
    stream: boolean,
    stepIndex: number,
    agent: Agent,
    input: string
  ): void {
    if (!stream) return;

    globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
      sender: "Workflow",
      recipient: agent.name,
      message: `Step ${stepIndex + 1}/${
        this.steps.length
      }: Running agent with input: ${
        input.length > 100 ? `${input.substring(0, 100)}...` : input
      }`,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit event when a step completes
   */
  private emitStepCompleteEvent(
    stream: boolean,
    stepIndex: number,
    agent: Agent,
    result: AgentResult,
    duration: number
  ): void {
    if (!stream) return;

    globalEventEmitter.emit(AgentForgeEvents.WORKFLOW_STEP_COMPLETE, {
      stepIndex: stepIndex,
      totalSteps: this.steps.length,
      agentName: agent.name,
      result: result,
      duration,
    });
  }

  /**
   * Log workflow start if verbose mode is enabled
   */
  private logWorkflowStart(input: string): void {
    if (!this.verbose) return;

    console.log(
      `\n🚀 Starting workflow execution with ${this.steps.length} steps`
    );
    console.log(`📋 Workflow: "${this.name}"`);
    console.log(`📋 Input: "${input}"\n`);
  }

  /**
   * Log step start if verbose mode is enabled
   */
  private logStepStart(stepIndex: number, agent: Agent): void {
    if (!this.verbose) return;

    console.log(
      `\n⏳ Step ${stepIndex + 1}/${this.steps.length}: Agent "${
        agent.name
      }" (${agent.role})`
    );
  }

  /**
   * Log input transformation if verbose mode is enabled
   */
  private logInputTransformation(transformedInput: string): void {
    if (!this.verbose) return;

    console.log(
      `🔄 Transformed input: "${transformedInput.substring(0, 100)}${
        transformedInput.length > 100 ? "..." : ""
      }"`
    );
  }

  /**
   * Log step completion if verbose mode is enabled
   */
  private logStepCompletion(
    stepIndex: number,
    duration: number,
    result: AgentResult
  ): void {
    if (!this.verbose) return;

    console.log(
      `✅ Step ${stepIndex + 1} completed in ${(duration / 1000).toFixed(2)}s`
    );
    console.log(
      `📤 Output: "${result.output.substring(0, 100)}${
        result.output.length > 100 ? "..." : ""
      }"`
    );
  }

  /**
   * Log workflow completion if verbose mode is enabled
   */
  private logWorkflowCompletion(): void {
    if (!this.verbose) return;

    console.log(`\n🏁 Workflow "${this.name}" completed successfully\n`);
  }

  /**
   * Sets up a rate limiter for LLM API calls
   * @param callsPerMinute Maximum number of calls allowed per minute
   */
  private setupRateLimiter(callsPerMinute: number): void {
    this.rateLimiter = {
      tokensRemaining: callsPerMinute,
      lastResetTime: Date.now(),
      waitingQueue: [],
    };

    // Patch the run method of all agents in the workflow to respect rate limiting
    for (const step of this.steps) {
      const agent = step.agent;
      const originalAgentRun = agent.run;
      agent.run = async (input: string, options?: AgentRunOptions) => {
        await this.waitForRateLimit();
        return originalAgentRun.call(agent, input, options);
      };
    }
  }

  /**
   * Waits until a rate limit token is available
   * @returns A promise that resolves when a token is available
   */
  private async waitForRateLimit(): Promise<void> {
    if (!this.rateLimiter) return;

    const now = Date.now();
    const timeSinceReset = now - this.rateLimiter.lastResetTime;

    // Reset tokens if a minute has passed
    if (timeSinceReset >= 60000) {
      const minutesPassed = Math.floor(timeSinceReset / 60000);
      this.rateLimiter.lastResetTime += minutesPassed * 60000;
      this.rateLimiter.tokensRemaining =
        this.rateLimiter.tokensRemaining +
        minutesPassed * this.rateLimiter.waitingQueue.length;

      // Process waiting queue if tokens are available
      while (
        this.rateLimiter.tokensRemaining > 0 &&
        this.rateLimiter.waitingQueue.length > 0
      ) {
        this.rateLimiter.tokensRemaining--;
        const resolveWaiting = this.rateLimiter.waitingQueue.shift();
        if (resolveWaiting) resolveWaiting();
      }
    }

    // If no tokens available, wait in queue
    if (this.rateLimiter.tokensRemaining <= 0) {
      if (this.verbose) {
        console.log("⏱️ Rate limit reached, waiting for next token...");
      }

      await new Promise<void>((resolve) => {
        if (this.rateLimiter) {
          this.rateLimiter.waitingQueue.push(resolve);
        }
      });

      if (this.verbose) {
        console.log("✅ Token received, continuing execution");
      }
    } else {
      // Token available, use it
      this.rateLimiter.tokensRemaining--;
    }
  }

  /**
   * Resets all agents in the workflow
   */
  reset(): void {
    for (const step of this.steps) {
      step.agent.resetConversation();
    }
  }
}
