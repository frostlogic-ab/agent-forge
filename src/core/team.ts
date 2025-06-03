import {
  AgentForgeEvents,
  type AgentResult,
  type Task,
  type TeamRunOptions,
} from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { RateLimiter } from "../utils/rate-limiter";
import { enableConsoleStreaming } from "../utils/streaming";
import { Agent, type AgentRunOptions } from "./agent";
import { AgentInteractionHelper } from "./team/agent-interaction-helper";
import { ManagerResponseParser } from "./team/manager-response-parser";
import { TaskExecutor } from "./team/task-executor";
import { TeamDeadlockHandler } from "./team/team-deadlock-handler";
import { TeamDependencyGraph } from "./team/team-dependency-graph";
import { TeamReporter } from "./team/team-reporter";
import { TeamRunLogger } from "./team/team-run-logger";
import { TeamTaskManager } from "./team/team-task-manager";
import { writeTeamRunTimelineHtmlToFile } from "./team/team-timeline-generator";
import { TASK_FORMAT_PROMPT } from "./team/team.constants";

/**
 * Represents a team of agents with a manager
 */
export class Team {
  private manager: Agent;
  private agents: Map<string, Agent> = new Map();
  private name: string;
  private description: string;
  private rateLimiterInstance?: RateLimiter;
  private verbose = false;
  private options?: TeamRunOptions;
  private originalAgentRuns = new WeakMap<Agent, Agent["run"]>();
  private managerResponseParser!: ManagerResponseParser;
  private teamDependencyGraph: TeamDependencyGraph;
  private agentInteractionHelper!: AgentInteractionHelper;
  private tasks: Map<string, Task> | undefined;
  private teamReporter!: TeamReporter;
  private teamTaskManager!: TeamTaskManager;
  private taskExecutor!: TaskExecutor;
  private teamDeadlockHandler!: TeamDeadlockHandler;
  private teamRunLogger?: TeamRunLogger;

  /**
   * Creates a new team with a manager agent
   * @param manager The manager agent
   * @param name Name of the team
   * @param description Description of the team
   */
  constructor(
    manager: Agent,
    name = "Team",
    description = "A team of agents with a manager"
  ) {
    this.manager = manager;
    this.name = name;
    this.description = description;
    this.teamDependencyGraph = new TeamDependencyGraph();
    // Enable visualization if the parent class has __visualizerEnabled
    if ((this.constructor as any).__visualizerEnabled) {
      this.teamRunLogger = new TeamRunLogger();
    }
  }

  /**
   * Sets the name of the team
   * @param name The new name
   * @returns The team instance for method chaining
   */
  setName(name: string): Team {
    this.name = name;
    return this;
  }

  /**
   * Sets the description of the team
   * @param description The new description
   * @returns The team instance for method chaining
   */
  setDescription(description: string): Team {
    this.description = description;
    return this;
  }

  /**
   * Gets the name of the team
   */
  getName(): string {
    return this.name;
  }

  /**
   * Gets the description of the team
   */
  getDescription(): string {
    return this.description;
  }

  /**
   * Adds an agent to the team
   * @param agent The agent to add must be an instance of Agent class or extend Agent class
   * @returns The team instance for method chaining
   */
  addAgent(agent: any): Team {
    if (!(agent instanceof Agent)) {
      throw new Error(
        "Agent must be an instance of Agent class or extend Agent class"
      );
    }
    this.agents.set(agent.name, agent);
    return this;
  }

  /**
   * Adds multiple agents to the team
   * @param agents The agents to add must be an instance of Agent class or extend Agent class
   * @returns The team instance for method chaining
   */
  addAgents(agents: any[]): Team {
    for (const agent of agents) {
      if (!(agent instanceof Agent)) {
        throw new Error(
          "Agent must be an instance of Agent class or extend Agent class"
        );
      }
      this.addAgent(agent);
    }
    return this;
  }

  /**
   * Gets an agent by name
   * @param name Name of the agent to get
   * @returns The agent instance
   */
  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  /**
   * Gets all agents in the team
   * @returns Array of agent instances
   */
  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Gets the manager agent
   */
  getManager(): Agent {
    return this.manager;
  }

  /**
   * Sets a different manager agent
   * @param manager The new manager agent
   */
  setManager(manager: Agent): void {
    this.manager = manager;
  }

  /**
   * Get the team run logger (for visualization/debugging)
   */
  public getTeamRunLogger(): TeamRunLogger | undefined {
    return this.teamRunLogger;
  }

  /**
   * Runs the team with the given input
   * The manager agent decides which agent(s) to use
   * @param input The input to the team
   * @param options Optional configuration for team execution
   * @returns The final result
   */
  async run(input: string, options?: TeamRunOptions): Promise<AgentResult> {
    if (this.teamRunLogger) {
      this.teamRunLogger.log({
        type: "TeamRunStart",
        summary: `Team run started with input: ${input}`,
        details: { input, options },
        timestamp: Date.now(),
      });
    }
    this.reset();
    this.options = options;
    this.verbose = options?.verbose || false;
    const stream = options?.stream || false;
    this.tasks = new Map<string, Task>();

    this.managerResponseParser = new ManagerResponseParser(this.agents);
    this.agentInteractionHelper = new AgentInteractionHelper(
      this._logVerbose,
      this.verbose
    );
    this.teamReporter = new TeamReporter(this.verbose, this._logVerbose);
    this.teamTaskManager = new TeamTaskManager(
      this.managerResponseParser,
      this.agents,
      this.teamDependencyGraph,
      this.verbose,
      this.teamRunLogger
    );
    this.taskExecutor = new TaskExecutor(
      this.agents,
      this.agentInteractionHelper,
      this._logVerbose,
      this._emitStreamEvent,
      this.options,
      this.tasks,
      this.teamRunLogger
    );
    this.teamDeadlockHandler = new TeamDeadlockHandler(
      this.manager,
      this._logVerbose,
      this.verbose,
      this.teamRunLogger
    );

    if (stream && options?.enableConsoleStream) {
      enableConsoleStreaming();
    }

    // Initialize rate limiter if needed
    if (options?.rate_limit && options.rate_limit > 0) {
      this.rateLimiterInstance = new RateLimiter({
        callsPerMinute: options.rate_limit,
        verbose: this.verbose,
      });

      const agentsToPatch = [this.manager, ...Array.from(this.agents.values())];
      for (const agent of agentsToPatch) {
        if (!this.originalAgentRuns.has(agent)) {
          this.originalAgentRuns.set(agent, agent.run); // Store original
          agent.run = async (
            agentInput: string,
            agentOptions?: AgentRunOptions
          ) => {
            if (this.rateLimiterInstance) {
              await this.rateLimiterInstance.waitForToken();
            }
            const storedOriginalRun = this.originalAgentRuns.get(agent);
            if (storedOriginalRun) {
              return storedOriginalRun.call(agent, agentInput, agentOptions);
            }
            throw new Error(
              "Original agent run method not found after patching."
            );
          };
        }
      }
    }

    this._logVerbose(
      `\n🚀 Starting team execution with ${this.agents.size} agents and 1 manager`
    );
    this._logVerbose(`📋 Task: "${input}"\n`);

    // Enhanced system message for the manager
    const agentDescriptions = Array.from(this.agents.values())
      .map(
        (agent) =>
          `- ${agent.name}: ${agent.role}. ${agent.description}. Objective: ${agent.objective}`
      )
      .join("\n");

    // Create a manager-specific prompt
    const managerPrompt = `
# Task 
${input}

# Instructions
You are the manager of a team. Your role is to analyze the task and decide which team member(s) should handle it.

## Task breakdown
- First, think carefully step by step about what subtasks are needed to answer the query and what are the dependencies between them.
- The task will be broken down into subtasks as needed, and assigned to the appropriate team member.
- CRITICAL: Ensure no task has a circular dependency (e.g., a task depending on itself or a chain of tasks that loops back). Dependencies must flow towards a final resolution.
- AVOID REDUNDANCY: Do not re-assign or re-create tasks that have already successfully completed and provided their output in previous steps, unless the goal or input parameters for that task have significantly changed. Refer to and use the results from already completed tasks whenever possible.
- You can't use the tools that your agents have.

## Task Management
- You can assign new tasks to any available team member.
- If a workflow gets stuck with pending tasks that can't proceed, you can:
  1. CANCEL tasks: Use "Cancel task: task-id" to cancel any pending task.
  2. MODIFY dependencies: Use "Modify task: task-id depends on: task-X, task-Y" (or "none") to change dependencies.
- Task management commands should be used when:
  - A task has incorrect dependencies
  - A task is redundant or no longer needed
  - A workflow is stuck in a deadlock situation
  - You need to restructure the workflow to make progress

## Team members
- Team members will be able to handle multiple tasks if needed.
- Team members will not talk between themselves, they will only do the tasks assigned to them.
- Always pass the required context to the team members.

**Available team members:**
${agentDescriptions}

## Format
${TASK_FORMAT_PROMPT}
`;
    this._logVerbose(`\n👨‍💼 Manager Prompt:\n${managerPrompt}\n`);

    // If streaming is enabled, emit an event to indicate team is starting
    if (stream) {
      this._emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: "Team",
        message: `Starting team "${this.name}" with task: ${input}`,
        timestamp: Date.now(),
      });
    }

    try {
      // Run the manager agent to orchestrate the team
      const result = await this.runTeamWithManager(managerPrompt);

      // If streaming is enabled, emit a completion event
      if (stream) {
        this._emitStreamEvent(AgentForgeEvents.EXECUTION_COMPLETE, {
          type: "team",
          name: this.name,
          result,
        });
      }

      if (this.teamRunLogger) {
        this.teamRunLogger.log({
          type: "TeamRunEnd",
          summary: "Team run completed",
          details: { result },
          timestamp: Date.now(),
        });
        // Write timeline HTML file
        const filePath = await writeTeamRunTimelineHtmlToFile(
          this.teamRunLogger.getEvents()
        );
        // eslint-disable-next-line no-console
        console.log(`\n[Visualizer] Team run timeline written to: ${filePath}`);
      }

      return result;
    } finally {
      this.rateLimiterInstance = undefined;
      // Unpatch agents
      const agentsToUnpatch = [
        this.manager,
        ...Array.from(this.agents.values()),
      ];
      for (const agent of agentsToUnpatch) {
        const originalRun = this.originalAgentRuns.get(agent);
        if (originalRun) {
          agent.run = originalRun;
          this.originalAgentRuns.delete(agent);
        }
      }
    }
  }

  /**
   * Resets all agent conversations
   */
  reset(): void {
    this.manager.resetConversation();
    for (const agent of this.agents.values()) {
      agent.resetConversation();
    }
  }

  /**
   * Initializes the team workflow by getting the manager's initial plan and ensuring tasks are assigned.
   * @param managerPrompt The initial prompt for the manager.
   * @param conversationHistory The conversation history array.
   * @returns The manager's response after ensuring task assignments.
   */
  private async _initializeTeamWorkflow(
    managerPrompt: string,
    conversationHistory: string[]
  ): Promise<string> {
    // Get the initial plan from the manager
    const managerResult = await this.manager.run(managerPrompt);
    conversationHistory.push(`Manager: ${managerResult.output}`);

    // Try to extract initial assignments or get explicit ones
    return await this.ensureTaskAssignments(
      managerResult.output,
      conversationHistory
    );
  }

  /**
   * Executes the main workflow iteration loop.
   * @param tasks Map of tasks.
   * @param failedTasks Set of failed task IDs.
   * @param taskIdCounter Current task ID counter.
   * @param initialManagerResponse The manager's response to start the loop.
   * @param conversationHistory Array of conversation history.
   * @returns An object with the final manager response and updated task ID counter.
   */
  private async _executeWorkflowIterations(
    tasks: Map<string, Task>,
    failedTasks: Set<string>,
    taskIdCounter: number,
    initialManagerResponse: string,
    conversationHistory: string[]
  ): Promise<{ finalManagerResponse: string; updatedTaskIdCounter: number }> {
    let currentManagerResponse = initialManagerResponse;
    let currentTaskIdCounter = taskIdCounter;
    const MAX_ITERATIONS = 10;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Check for task modification or cancellation requests
      const taskChanges = this.teamTaskManager.processTaskChanges(
        currentManagerResponse,
        tasks,
        conversationHistory,
        this._logVerbose
      );

      if (taskChanges) {
        // If changes were made, give manager feedback
        const changeReport =
          this.teamReporter.generateTaskChangeReport(taskChanges);
        const changesResult = await this.manager.run(changeReport);
        currentManagerResponse = changesResult.output;
        conversationHistory.push(
          `Manager (Changes): ${currentManagerResponse}`
        );
      }

      // Create new tasks from manager's assignments
      currentTaskIdCounter = this.teamTaskManager.createTasksFromAssignments(
        currentManagerResponse,
        tasks,
        currentTaskIdCounter,
        conversationHistory,
        this._logVerbose
      );

      // Find and execute ready tasks
      const results = await this.processReadyTasks(
        tasks,
        failedTasks,
        conversationHistory
      );

      // If we have results, prepare progress report and get next instructions
      if (results && results.length > 0) {
        // Get the manager's next instructions based on progress
        const progressReport = this.teamReporter.generateProgressReport(
          results,
          tasks
        );

        const nextManagerResult = await this.getNextManagerInstructions(
          progressReport,
          conversationHistory
        );

        currentManagerResponse = nextManagerResult.output;

        // Check if the workflow is complete
        if (this.isWorkflowCompletionMarked(currentManagerResponse)) {
          this._logVerbose(
            "🔔 Manager indicated workflow completion. Finalizing..."
          );
          break;
        }
      } else {
        // Handle cases with no ready tasks
        if (this.isWorkflowComplete(tasks)) {
          this._logVerbose(
            "🔔 All tasks have been completed. Finalizing workflow..."
          );
          break;
        }

        // Check for deadlocks and get manager guidance if needed
        const deadlockResult =
          await this.teamDeadlockHandler.handlePotentialDeadlock(
            tasks,
            conversationHistory
          );

        currentManagerResponse = deadlockResult.output;

        if (this.isWorkflowCompletionMarked(currentManagerResponse)) {
          this._logVerbose(
            "🔔 Manager resolved deadlock with workflow completion. Finalizing..."
          );
          break;
        }
      }
    }
    return {
      finalManagerResponse: currentManagerResponse,
      updatedTaskIdCounter: currentTaskIdCounter,
    };
  }

  /**
   * Internal method to run the team with the manager
   * @param managerPrompt The prompt for the manager
   * @returns The final result
   */
  private async runTeamWithManager(
    managerPrompt: string
  ): Promise<AgentResult> {
    const conversationHistory: string[] = [];
    let currentManagerResponse = await this._initializeTeamWorkflow(
      managerPrompt,
      conversationHistory
    );

    // Task tracking
    const tasks: Map<string, Task> = new Map();
    this.tasks = tasks; // Store tasks reference for access by other methods
    const failedTasks: Set<string> = new Set();
    const taskIdCounter = 1; // Start from 1 to match human expectations

    const workflowResult = await this._executeWorkflowIterations(
      tasks,
      failedTasks,
      taskIdCounter,
      currentManagerResponse,
      conversationHistory
    );

    currentManagerResponse = workflowResult.finalManagerResponse;
    // taskIdCounter = workflowResult.updatedTaskIdCounter; // taskIdCounter is not used after the loop for final result generation

    // Generate final summary and result
    return await this.teamReporter.generateFinalResult(
      tasks,
      conversationHistory,
      this.manager
    );
  }

  /**
   * Logs a message to the console if verbose mode is enabled.
   * @param message The message to log.
   * @param icon Optional icon to prefix the message.
   */
  private _logVerbose = (message: string, icon?: string): void => {
    if (this.verbose) {
      console.log(icon ? `${icon} ${message}` : message);
    }
  };

  /**
   * Emits a stream event if streaming is enabled.
   * @param eventName The name of the event to emit.
   * @param payload The payload for the event.
   */
  private _emitStreamEvent(eventName: AgentForgeEvents, payload: any): void {
    if (this.options?.stream) {
      globalEventEmitter.emit(eventName, payload);
    }
  }

  /**
   * Ensures tasks are properly assigned by the manager
   */
  private async ensureTaskAssignments(
    currentResponse: string,
    conversationHistory: string[]
  ): Promise<string> {
    const initialAssignments =
      this.managerResponseParser.extractAgentAssignments(currentResponse);

    if (initialAssignments.length === 0) {
      this._logVerbose(
        "🔄 No explicit task assignments found. Asking manager for clear assignments..."
      );

      const explicitAssignmentPrompt = `
You need to assign specific tasks to team members to complete this work.

Please use this EXACT format for each task:
${TASK_FORMAT_PROMPT}

What tasks would you like to assign to each team member?
`;
      const explicitAssignmentResult = await this.manager.run(
        `${currentResponse}\n\n${explicitAssignmentPrompt}`
      );

      const newResponse = explicitAssignmentResult.output;
      conversationHistory.push(`Manager (Task Assignment): ${newResponse}`);

      this._logVerbose(`\n👨‍💼 Manager (Task Assignment):\n${newResponse}\n`);

      return newResponse;
    }

    if (this.verbose && initialAssignments.length > 0) {
      this._logVerbose(`\n👨‍💼 Manager (Initial Plan):\n${currentResponse}\n`);
      this._logVerbose(
        `✅ Found ${initialAssignments.length} explicit task assignments`
      );
    }

    return currentResponse;
  }

  /**
   * Processes and executes tasks that are ready to run
   */
  private async processReadyTasks(
    tasks: Map<string, Task>,
    failedTasks: Set<string>,
    conversationHistory: string[]
  ): Promise<Task[]> {
    // Process ready tasks (no dependencies or all dependencies completed)
    const readyTasks = this.teamTaskManager.findReadyTasks(tasks);

    if (readyTasks.length === 0) {
      this.teamTaskManager.handleTasksWithFailedDependencies(
        tasks,
        failedTasks,
        conversationHistory,
        this._logVerbose
      );
      return [];
    }

    // Execute all ready tasks in parallel
    const taskPromises = readyTasks.map((task) =>
      this.taskExecutor.executeTask(task, conversationHistory)
    );

    // Wait for all tasks to complete
    return await Promise.all(taskPromises);
  }

  /**
   * Gets the next instructions from the manager based on progress
   */
  private async getNextManagerInstructions(
    progressReport: string,
    conversationHistory: string[]
  ): Promise<AgentResult> {
    // Get stream option from team options
    const stream = this.options?.stream || false;

    // If streaming, emit event that manager is being updated - only once
    if (stream) {
      this._emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: "Team",
        recipient: "Manager",
        message: `Progress report: ${progressReport}`,
        timestamp: Date.now(),
      });
    }

    // Execute the manager with streaming if enabled
    const managerResult = await this.manager.run(progressReport, { stream });

    // Add the manager's response to the conversation history - only once
    conversationHistory.push(`Manager: ${managerResult.output}`);

    return managerResult;
  }

  /**
   * Checks if the workflow is complete
   */
  private isWorkflowComplete(tasks: Map<string, Task>): boolean {
    // No tasks created yet
    if (tasks.size === 0) {
      return false;
    }

    // Check if all tasks are either completed, failed, or canceled
    const allTasksFinished = [...tasks.values()].every(
      (t) =>
        t.status === "completed" ||
        t.status === "failed" ||
        t.status === "canceled"
    );

    // If there are pending or in-progress tasks, the workflow is not complete
    const hasPendingTasks = [...tasks.values()].some(
      (t) => t.status === "pending" || t.status === "in_progress"
    );

    return allTasksFinished && !hasPendingTasks;
  }

  /**
   * Checks if manager response indicates workflow completion
   */
  private isWorkflowCompletionMarked(response: string): boolean {
    const completionMarkers = [
      "WORKFLOW COMPLETE",
      "ALL TASKS COMPLETE",
      "FINAL RESPONSE",
      "FINAL ANSWER",
    ];

    return completionMarkers.some((marker) =>
      response.toUpperCase().includes(marker)
    );
  }
}
