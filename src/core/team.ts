import { AgentForgeEvents, type AgentResult } from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { RateLimiter } from "../utils/rate-limiter";
import { enableConsoleStreaming } from "../utils/streaming";
import type { Agent, AgentRunOptions } from "./agent";

/**
 * Defines the structure of a task managed by the Team.
 */
interface Task {
  id: string;
  agentName: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "canceled";
  dependencies: string[]; // IDs of tasks that must be completed first
  result?: string; // Should this be string or any/unknown if tools return complex objects?
  startTime?: number;
  endTime?: number;
}

const TASK_FORMAT_PROMPT = `
**For each subtask, use this EXACT format:**
**Task #:** [Task title]
**Team member:** [Team member name]
**Why:** [Brief explanation]
**Subtask:** [Clear description of what they need to do]
**Depends on:** [Task ID(s) from 'Current task status' for PREVIOUSLY COMPLETED tasks, or system-generated IDs for other tasks you are defining in THIS planning step, or "none". The task ID format is "task-1, task-2, task-3" or "none"]

**IMPORTANT:** Tasks will be processed in parallel unless you specify dependencies! For sequential tasks, you MUST use the "Depends on:" field.
**IMPORTANT:** Wait for each team member's response before proceeding with dependent tasks. When all subtasks are completed, provide a final response to the original task.
**NOTE:** You can modify or cancel tasks using the "Modify task:" or "Cancel task:" directives if a workflow gets stuck.`;

/**
 * Options for team execution
 */
export interface TeamRunOptions {
  /**
   * Maximum number of LLM calls allowed per minute (default: no limit)
   * Used to prevent hitting API rate limits
   */
  rate_limit?: number;

  /**
   * Enable detailed logging of communication between manager and agents (default: false)
   * Useful for debugging team interactions
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
   * @param agent The agent to add
   * @returns The team instance for method chaining
   */
  addAgent(agent: Agent): Team {
    this.agents.set(agent.name, agent);
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
   * Runs the team with the given input
   * The manager agent decides which agent(s) to use
   * @param input The input to the team
   * @param options Optional configuration for team execution
   * @returns The final result
   */
  async run(input: string, options?: TeamRunOptions): Promise<AgentResult> {
    this.reset();
    this.options = options;
    this.verbose = options?.verbose || false;
    const stream = options?.stream || false;

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
      const taskChanges = this.processTaskChanges(
        currentManagerResponse,
        tasks,
        conversationHistory
      );

      if (taskChanges) {
        // If changes were made, give manager feedback
        const changeReport = this.generateTaskChangeReport(taskChanges);
        const changesResult = await this.manager.run(changeReport);
        currentManagerResponse = changesResult.output;
        conversationHistory.push(
          `Manager (Changes): ${currentManagerResponse}`
        );
      }

      // Create new tasks from manager's assignments
      currentTaskIdCounter = this.createTasksFromAssignments(
        currentManagerResponse,
        tasks,
        currentTaskIdCounter,
        conversationHistory
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
        const progressReport = this.generateProgressReport(results, tasks);

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
        const deadlockResult = await this.handlePotentialDeadlock(
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
    return await this.generateFinalResult(tasks, conversationHistory);
  }

  /**
   * Add tasks property to Team class
   */
  private tasks: Map<string, Task> | undefined;

  /**
   * Logs a message to the console if verbose mode is enabled.
   * @param message The message to log.
   * @param icon Optional icon to prefix the message.
   */
  private _logVerbose(message: string, icon?: string): void {
    if (this.verbose) {
      console.log(icon ? `${icon} ${message}` : message);
    }
  }

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
    const initialAssignments = this.extractAgentAssignments(currentResponse);

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
   * Creates tasks from manager's assignments
   */
  private createTasksFromAssignments(
    managerResponse: string,
    tasks: Map<string, Task>,
    taskIdCounter: number,
    conversationHistory: string[]
  ): number {
    const rawAssignments = this.extractAgentAssignments(managerResponse);
    let counter = taskIdCounter;

    if (rawAssignments.length === 0 && tasks.size === 0) {
      counter = this.createDefaultTasksForAllAgents(
        managerResponse,
        tasks,
        counter,
        conversationHistory
      );
    } else {
      // Log task assignments for debugging if verbose
      if (this.verbose && rawAssignments.length > 0) {
        this._logVerbose(`🔍 Found ${rawAssignments.length} task assignments:`);
        for (const assignment of rawAssignments) {
          this._logVerbose(
            `- ${assignment.agentName}: ${assignment.task.substring(0, 50)}...`
          );
        }
      }

      counter = this.processAssignedTasks(
        rawAssignments,
        tasks,
        counter,
        conversationHistory
      );
    }

    // Log all created tasks for debugging if verbose
    if (this.verbose) {
      this._logVerbose(`📋 Current task status (${tasks.size} total tasks):`);
      for (const [taskId, task] of tasks.entries()) {
        this._logVerbose(
          `- ${taskId} (${task.agentName}): ${task.status}, Dependencies: ${task.dependencies.join(", ") || "none"}`
        );
      }
    }

    return counter;
  }

  /**
   * Creates default tasks for all agents when no explicit assignments are found
   */
  private createDefaultTasksForAllAgents(
    managerResponse: string,
    tasks: Map<string, Task>,
    taskIdCounter: number,
    conversationHistory: string[]
  ): number {
    let counter = taskIdCounter;

    if (this.verbose) {
      this._logVerbose(
        "⚠️ Still no explicit assignments. Creating default tasks for all agents..."
      );
    }

    for (const agent of this.agents.values()) {
      const taskId = `task-${counter++}`;
      const description = `Based on the manager's instructions, please work on: ${managerResponse}`;

      tasks.set(taskId, {
        id: taskId,
        agentName: agent.name,
        description,
        status: "pending",
        dependencies: [],
      });

      this.logTaskCreation(
        taskId,
        agent.name,
        description,
        conversationHistory,
        true
      );
    }

    return counter;
  }

  /**
   * Processes assignments from the manager and creates corresponding tasks
   */
  private processAssignedTasks(
    assignments: Array<{ agentName: string; task: string }>,
    tasks: Map<string, Task>,
    taskIdCounter: number,
    conversationHistory: string[]
  ): number {
    let counter = taskIdCounter;

    // Track agents that already have tasks
    const agentsWithPendingTasks = new Set<string>();
    for (const task of tasks.values()) {
      if (task.status === "pending" || task.status === "in_progress") {
        agentsWithPendingTasks.add(task.agentName);
      }
    }

    for (const assignment of assignments) {
      const { agentName, task: description } = assignment;

      // Skip if agent doesn't exist
      if (!this.agents.has(agentName)) {
        this.logSkippedTask(agentName, conversationHistory);
        continue;
      }

      // Skip if agent already has a pending task - prevent duplicate assignments
      if (agentsWithPendingTasks.has(agentName)) {
        const message = `System: Skipped duplicate task assignment for ${agentName} who already has a pending task`;
        conversationHistory.push(message);
        if (this.verbose) {
          this._logVerbose(`⚠️ ${message}`);
        }
        continue;
      }

      // Add this agent to the set of agents with tasks
      agentsWithPendingTasks.add(agentName);

      const taskId = `task-${counter++}`;
      const dependencies = this.extractDependenciesFromDescription(description);

      // Check for self-dependency and circular dependencies
      const filteredDependencies = dependencies.filter((dep) => dep !== taskId);

      if (filteredDependencies.length !== dependencies.length) {
        const message = `System: Warning - Removed self-dependency from task ${taskId}`;
        conversationHistory.push(message);
        if (this.verbose) {
          this._logVerbose(`⚠️ ${message}`);
        }
      }

      // Add the task without checking circular dependencies first
      tasks.set(taskId, {
        id: taskId,
        agentName,
        description,
        status: "pending",
        dependencies: filteredDependencies,
      });

      // Now check for potential circular dependencies
      const cycles = this.detectCircularDependencies(
        taskId,
        filteredDependencies,
        tasks
      );

      if (cycles.length > 0) {
        // Remove the problematic dependencies
        const cyclicDeps = new Set<string>();
        for (const cycle of cycles) {
          for (const dep of cycle) {
            if (dep !== taskId && filteredDependencies.includes(dep)) {
              cyclicDeps.add(dep);
            }
          }
        }

        // Update the task with non-cyclic dependencies
        const safeDepList = filteredDependencies.filter(
          (dep) => !cyclicDeps.has(dep)
        );
        const taskToUpdate = tasks.get(taskId);
        if (taskToUpdate) {
          taskToUpdate.dependencies = safeDepList;
        }

        // Log the changes
        const message = `System: Warning - Removed cyclic dependencies ${Array.from(cyclicDeps).join(", ")} from task ${taskId}`;
        conversationHistory.push(message);
        if (this.verbose) {
          this._logVerbose(`⚠️ ${message}`);
        }

        this.logTaskCreation(
          taskId,
          agentName,
          description,
          conversationHistory,
          false,
          safeDepList
        );
      } else {
        this.logTaskCreation(
          taskId,
          agentName,
          description,
          conversationHistory,
          false,
          filteredDependencies
        );
      }
    }

    return counter;
  }

  /**
   * Extracts task dependencies from a task description
   */
  private extractDependenciesFromDescription(description: string): string[] {
    // Look for dependencies in the markdown format with the task-X format
    const markdownMatch = description.match(
      /\*\*Depends on:\*\*\s*((?:task-\d+(?:,\s*)?)+|none)/i
    );

    if (markdownMatch) {
      const dependsOn = markdownMatch[1].trim().toLowerCase();
      return dependsOn === "none"
        ? []
        : dependsOn.split(",").map((id) => id.trim());
    }
    return [];
  }

  /**
   * Logs task creation to conversation history and console if verbose
   */
  private logTaskCreation(
    taskId: string,
    agentName: string,
    description: string,
    conversationHistory: string[],
    isDefault = false,
    dependencies: string[] = []
  ): void {
    const logMessage = isDefault
      ? `System: Created default task ${taskId} for ${agentName}: ${description}...`
      : `System: Created task ${taskId} for ${agentName}: ${description}`;

    conversationHistory.push(logMessage);
    if (this.verbose) {
      const icon = isDefault ? "🤖" : "🔄";
      this._logVerbose(
        `${icon} System: Created task ${taskId} for ${agentName}: ${description.substring(
          0,
          100
        )}${description.length > 100 ? "..." : ""}`
      );

      if (dependencies.length > 0) {
        this._logVerbose(`📌 Dependencies: ${dependencies.join(", ")}`);
      }
    }
  }

  /**
   * Logs a skipped task due to missing agent
   */
  private logSkippedTask(
    agentName: string,
    conversationHistory: string[]
  ): void {
    const message = `System: Agent "${agentName}" does not exist. Task skipped.`;
    conversationHistory.push(message);

    if (this.verbose) {
      this._logVerbose(`⚠️ ${message}`);
    }
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
    const readyTasks = this.findReadyTasks(tasks);

    if (readyTasks.length === 0) {
      this.handleTasksWithFailedDependencies(
        tasks,
        failedTasks,
        conversationHistory
      );
      return [];
    }

    // Execute all ready tasks in parallel
    const taskPromises = readyTasks.map((task) =>
      this.executeTask(task, conversationHistory)
    );

    // Wait for all tasks to complete
    return await Promise.all(taskPromises);
  }

  /**
   * Finds tasks that are ready to execute
   */
  private findReadyTasks(tasks: Map<string, Task>): Task[] {
    const readyTasks: Task[] = [];

    for (const task of tasks.values()) {
      if (task.status === "pending") {
        const allDependenciesMet = task.dependencies.every((depId: string) => {
          const depTask = tasks.get(depId);
          return depTask?.status === "completed";
        });

        if (allDependenciesMet) {
          task.status = "in_progress";
          task.startTime = Date.now();
          readyTasks.push(task);
        }
      }
    }

    return readyTasks;
  }

  /**
   * Handles tasks with failed dependencies
   */
  private handleTasksWithFailedDependencies(
    tasks: Map<string, Task>,
    failedTasks: Set<string>,
    conversationHistory: string[]
  ): boolean {
    let pendingTasksWithFailedDeps = false;

    for (const task of tasks.values()) {
      if (task.status === "pending") {
        const hasFailedDependency = task.dependencies.some((depId: string) =>
          failedTasks.has(depId)
        );

        if (hasFailedDependency) {
          task.status = "failed";
          failedTasks.add(task.id);

          conversationHistory.push(
            `System: Task ${task.id} for ${task.agentName} failed because its dependencies failed.`
          );
          pendingTasksWithFailedDeps = true;
        }
      }
    }

    return pendingTasksWithFailedDeps;
  }

  /**
   * Collects results from dependency tasks.
   * @param task The current task.
   * @returns An array of dependency results.
   */
  private _collectDependencyResults(
    task: Task
  ): { taskId: string; result: string }[] {
    const dependencyResults: { taskId: string; result: string }[] = [];
    for (const depId of task.dependencies) {
      const depTask = this.tasks?.get(depId);
      if (depTask?.result) {
        dependencyResults.push({
          taskId: depTask.id,
          result: depTask.result,
        });
      }
    }
    return dependencyResults;
  }

  /**
   * Formats the task description for the agent, including dependency results.
   * @param task The task to format.
   * @param dependencyResults The results from dependency tasks.
   * @returns The formatted task string.
   */
  private _formatTaskForAgent(
    task: Task,
    dependencyResults: { taskId: string; result: string }[]
  ): string {
    return `
Task: ${task.description}

${
  dependencyResults.length > 0
    ? `## Results from Dependency Tasks (Use this data for your task)\n\n${dependencyResults
        .map((dep) => `### Result from ${dep.taskId}:\n${dep.result}`)
        .join("\n\n")}\n\n`
    : ""
}

${
  task.dependencies && task.dependencies.length > 0
    ? `This task depends on previous work: ${task.dependencies.join(", ")}`
    : ""
}

Please provide a clear and detailed response.
IMPORTANT: If you need to use tools like search or fetch, be sure to EXECUTE them rather than just showing the code.
IMPORTANT: You already have access to the results of dependency tasks above. DO NOT try to use tools to retrieve them.

IMPORTANT: If you encounter any tool execution errors, please clearly state that you're unable to access the requested data. DO NOT make up or estimate data - stick strictly to facts.
`;
  }

  /**
   * Handles a scenario where an agent might have returned tool code without executing it.
   * It prompts the agent to execute the code and updates the task result accordingly.
   * @param task The task being processed.
   * @param agent The agent responsible for the task.
   * @param agentResult The initial result from the agent.
   * @param stream Whether streaming is enabled.
   * @returns The updated task result string.
   */
  private async _handleUnexecutedToolCode(
    task: Task,
    agent: Agent,
    agentResult: AgentResult,
    stream: boolean
  ): Promise<string> {
    const executionPrompt = `
I notice you provided some tool code without executing it. Please execute any tool code you've written.
Here was your response:

${agentResult.output}

Please run all the tool code and provide the results.

IMPORTANT: If the tool execution fails, please clearly indicate that the tool failed. DO NOT make up or simulate any data - if you can't access the data, simply state that fact clearly.
`;

    if (this.verbose) {
      this._logVerbose(
        `⚠️ Detected unexecuted tool code in ${agent.name}'s response. Requesting execution...`
      );
    }

    if (stream) {
      this._emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: "Manager",
        recipient: agent.name,
        message: `Please execute the tool code you've provided rather than just showing it.`,
        timestamp: Date.now(),
      });
    }

    try {
      const executionResult = await agent.run(executionPrompt, { stream });

      if (
        !executionResult.metadata?.toolCalls &&
        this.detectUnexecutedToolCode(executionResult.output)
      ) {
        const factBasedErrorPrompt = `
It appears that the tools could not be executed successfully. Please acknowledge this limitation clearly in your response.

Do not make up or simulate any data.

Please provide a clear response that:
1. Acknowledges the tool execution issue
2. Explains that you cannot provide the requested data without the tools
3. Suggests alternative approaches if appropriate (such as the user checking other sources)

Remember: stick strictly to facts, do not generate mock or simulated data.
`;
        const factBasedErrorResult = await agent.run(factBasedErrorPrompt, {
          stream,
        });
        task.status = "failed"; // Mark task as failed
        return `${agentResult.output}\n\n---\n\nTool Execution Issue:\n${factBasedErrorResult.output}`;
      }
      return `${agentResult.output}\n\n---\n\nExecution results:\n${executionResult.output}`;
    } catch (error) {
      if (this.verbose) {
        this._logVerbose(`❌ Error during tool code execution: ${error}`);
      }
      try {
        const factBasedErrorPrompt = `
The tool execution has failed with the following error: ${error}

Please acknowledge this limitation clearly in your response.

Do not make up or simulate any data.

Please provide a clear response that:
1. Acknowledges the tool execution issue
2. Explains that you cannot provide the requested data without the tools
3. Suggests alternative approaches if appropriate (such as the user checking other sources)

Remember: stick strictly to facts, do not generate mock or simulated data.
`;
        const errorResult = await agent.run(factBasedErrorPrompt, { stream });
        task.status = "failed"; // Mark task as failed
        return `${agentResult.output}\n\n---\n\nTool Execution Error: ${error}\n\n${errorResult.output}`;
      } catch (_errorHandlingError) {
        task.status = "failed"; // Mark task as failed
        return `${agentResult.output}\n\n---\n\nTool Execution Error: ${error}\n\nUnable to execute tools. No data could be retrieved.`;
      }
    }
  }

  /**
   * Executes a single task
   */
  private async executeTask(
    task: Task,
    conversationHistory: string[]
  ): Promise<Task> {
    const agentName = task.agentName;
    const agent = this.agents.get(agentName);

    if (!agent) {
      throw new Error(`Agent '${agentName}' not found in team`);
    }

    // Collect results from dependencies
    const dependencyResults = this._collectDependencyResults(task);

    // Format the task for the agent
    const formattedTask = this._formatTaskForAgent(task, dependencyResults);

    // Get stream option from team options
    const stream = this.options?.stream || false;

    // If streaming, emit event that agent is starting only once
    if (stream) {
      this._emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: "Manager",
        recipient: agentName,
        message: `I'm assigning you the following task: ${task.description}`,
        timestamp: Date.now(),
      });
    }

    try {
      // Execute the agent with streaming if enabled
      const agentResult = await agent.run(formattedTask, { stream });

      // Check if the result contains unexecuted tool code
      const containsUnexecutedToolCode = this.detectUnexecutedToolCode(
        agentResult.output
      );

      // Check if the agent has tools available (using hasTools method)
      const hasTools = this.agentHasTools(agent);

      if (containsUnexecutedToolCode && hasTools) {
        task.result = await this._handleUnexecutedToolCode(
          task,
          agent,
          agentResult,
          stream
        );
      } else {
        // Update the task with the result
        task.result = agentResult.output;
      }

      task.status = task.status === "failed" ? "failed" : "completed"; // Preserve failed status if set by _handleUnexecutedToolCode
    } catch (error) {
      // Handle any errors during task execution
      task.result = `Error executing task: ${error}`;
      task.status = "failed";

      if (this.verbose) {
        this._logVerbose(`❌ Error executing task ${task.id}: ${error}`);
      }
    }

    task.endTime = Date.now();

    // Add the result to the conversation history only once
    conversationHistory.push(`${agentName}: ${task.result}`);

    // If streaming, emit task completion event only once
    if (stream) {
      this._emitStreamEvent(AgentForgeEvents.TEAM_TASK_COMPLETE, {
        taskId: task.id,
        agentName: task.agentName,
        description: task.description,
        result: task.result,
      });

      // Also emit agent communication for manager - only once
      this._emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: agentName,
        recipient: "Manager",
        message: task.result,
        timestamp: Date.now(),
      });
    }

    return task;
  }

  /**
   * Helper method to check if an agent has tools available
   * @param agent The agent to check
   * @returns True if the agent has tools, false otherwise
   */
  private agentHasTools(agent: Agent): boolean {
    // Check if the agent has a method to get tools
    if (typeof agent.getTools === "function") {
      try {
        const tools = agent.getTools();
        return Array.isArray(tools) && tools.length > 0;
      } catch (_error) {
        // Ignore errors and return false
        return false;
      }
    }
    return false;
  }

  /**
   * Detects if the agent's response contains unexecuted tool code
   * @param output The agent's output
   * @returns True if unexecuted tool code is detected, false otherwise
   */
  private detectUnexecutedToolCode(output: string): boolean {
    // Check for tool code blocks
    const toolCodeRegex = /```(?:tool_code|python)[\s\S]*?```/g;
    const toolCodeMatches = output.match(toolCodeRegex);

    if (!toolCodeMatches) {
      return false;
    }

    // Check if there's no substantive content after the code block
    for (const match of toolCodeMatches) {
      const matchIndex = output.indexOf(match) + match.length;
      const remainingText = output.slice(matchIndex).trim();

      if (
        !remainingText ||
        (!remainingText.includes("result") &&
          !remainingText.includes("found") &&
          !remainingText.includes("output"))
      ) {
        return true;
      }

      // Check if after the code block there's any data output
      // For example, typical output formats like JSON, numbers, or structured data
      const hasDataAfterCode = /\{.*\}|\[.*\]|\d+\.\d+|"[^"]*"/s.test(
        remainingText
      );
      if (!hasDataAfterCode) {
        return true;
      }
    }

    return false;
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
   * Generate a progress report showing task status
   */
  private generateProgressReport(
    results: Task[],
    tasks: Map<string, Task>
  ): string {
    // Create a more structured task progress report
    let report = "\n# Current Task Status\n";
    for (const task of tasks.values()) {
      report += `**Task ID:** ${task.id}\n`;
      report += `**Agent:** ${task.agentName}\n`;
      report += `**Status:** ${task.status}\n`;
      if (task.dependencies.length > 0) {
        report += `**Depends on:** ${task.dependencies.join(", ")}\n`;
      }
      if (task.result) {
        report += `**Result:** ${task.result.substring(0, 200)}${task.result.length > 200 ? "..." : ""}\n`;
      }
      report += "---\n";
    }

    if (results.length > 0) {
      report += "\n# Recent Task Results\n";
      for (const task of results) {
        report += `**Task ID:** ${task.id}\n`;
        report += `**Agent:** ${task.agentName}\n`;
        report += `**Status:** ${task.status}\n`;
        if (task.result) {
          report += `**Result:** ${task.result.substring(0, 200)}${task.result.length > 200 ? "..." : ""}\n`;
        }
        report += "---\n";
      }
    }
    return report;
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

  /**
   * Process task modification or cancellation requests from the manager
   * @param managerResponse The manager's response message
   * @param tasks Map of all tasks
   * @param conversationHistory Conversation history array
   * @returns Object containing lists of modified and canceled tasks, or null if no changes
   */
  private processTaskChanges(
    managerResponse: string,
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): { modified: string[]; canceled: string[] } | null {
    const modified: string[] = [];
    const canceled: string[] = [];
    let changesMade = false;

    // Check for task cancellation requests
    const cancelPattern = /Cancel\s+task:\s+(task-\d+)/gi;
    let cancelMatch: RegExpExecArray | null =
      cancelPattern.exec(managerResponse);

    while (cancelMatch !== null) {
      const taskId = cancelMatch[1];
      const taskCanceled = this.cancelTask(taskId, tasks, conversationHistory);
      if (taskCanceled) {
        changesMade = true;
        canceled.push(taskId);
      }
      cancelMatch = cancelPattern.exec(managerResponse);
    }

    // Check for dependency modification requests
    const modifyPattern =
      /Modify\s+task:\s+(task-\d+)\s+depends\s+on:\s+((?:task-\d+(?:,\s*)?)*|none)/gi;
    let modifyMatch: RegExpExecArray | null =
      modifyPattern.exec(managerResponse);

    while (modifyMatch !== null) {
      const taskId = modifyMatch[1];
      const newDepsStr = modifyMatch[2].trim().toLowerCase();
      const newDeps =
        newDepsStr === "none"
          ? []
          : newDepsStr.split(",").map((id) => id.trim());

      const taskModified = this.modifyTaskDependencies(
        taskId,
        newDeps,
        tasks,
        conversationHistory
      );
      if (taskModified) {
        changesMade = true;
        modified.push(taskId);
      }
      modifyMatch = modifyPattern.exec(managerResponse);
    }

    return changesMade ? { modified, canceled } : null;
  }

  /**
   * Cancels a task by ID
   * @param taskId The ID of the task to cancel
   * @param tasks Map of all tasks
   * @param conversationHistory Conversation history array
   * @returns True if task was canceled, false otherwise
   */
  private cancelTask(
    taskId: string,
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): boolean {
    const task = tasks.get(taskId);

    if (!task) {
      const message = `System: Cannot cancel task ${taskId} - task not found`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return false;
    }

    if (task.status === "in_progress" || task.status === "completed") {
      const message = `System: Cannot cancel task ${taskId} - task is already ${task.status}`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return false;
    }

    // Mark the task as canceled
    task.status = "canceled";
    task.endTime = Date.now();

    const message = `System: Successfully canceled task ${taskId}`;
    conversationHistory.push(message);
    if (this.verbose) {
      this._logVerbose(`🚫 ${message}`);
    }

    // Check for dependent tasks and fail them
    for (const [otherId, otherTask] of tasks.entries()) {
      if (
        otherTask.dependencies.includes(taskId) &&
        otherTask.status === "pending"
      ) {
        const failMessage = `System: Task ${otherId} failed because its dependency ${taskId} was canceled`;
        conversationHistory.push(failMessage);
        otherTask.status = "failed";
        otherTask.endTime = Date.now();

        if (this.verbose) {
          this._logVerbose(`⛔ ${failMessage}`);
        }
      }
    }

    return true;
  }

  /**
   * Modifies a task's dependencies
   * @param taskId The ID of the task to modify
   * @param newDependencies Array of new dependency task IDs
   * @param tasks Map of all tasks
   * @param conversationHistory Conversation history array
   * @returns True if dependencies were modified, false otherwise
   */
  private modifyTaskDependencies(
    taskId: string,
    newDependencies: string[],
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): boolean {
    const task = tasks.get(taskId);

    if (!task) {
      const message = `System: Cannot modify task ${taskId} - task not found`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return false;
    }

    if (task.status !== "pending") {
      const message = `System: Cannot modify dependencies of task ${taskId} - task is already ${task.status}`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return false;
    }

    // Check if new dependencies exist
    const missingDeps = newDependencies.filter((depId) => !tasks.has(depId));
    if (missingDeps.length > 0) {
      const message = `System: Cannot modify dependencies of task ${taskId} - dependencies not found: ${missingDeps.join(", ")}`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return false;
    }

    // Check for circular dependencies
    const cycles = this.detectCircularDependencies(
      taskId,
      newDependencies,
      tasks
    );
    if (cycles.length > 0) {
      const message = `System: Cannot modify dependencies of task ${taskId} - would create circular dependencies`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
        for (const cycle of cycles) {
          this._logVerbose(`  Cycle: ${cycle.join(" -> ")}`);
        }
      }
      return false;
    }

    // Update dependencies
    const oldDeps = task.dependencies;
    task.dependencies = newDependencies;

    const message = `System: Successfully modified dependencies of task ${taskId} from [${oldDeps.join(", ") || "none"}] to [${newDependencies.join(", ") || "none"}]`;
    conversationHistory.push(message);
    if (this.verbose) {
      this._logVerbose(`🔄 ${message}`);
    }

    return true;
  }

  /**
   * Generates a report of task changes for the manager
   * @param changes Object containing lists of modified and canceled tasks
   * @returns A formatted report
   */
  private generateTaskChangeReport(changes: {
    modified: string[];
    canceled: string[];
  }): string {
    let report = "# Task Changes Applied\n\n";

    if (changes.canceled.length > 0) {
      report += "## Canceled Tasks\n";
      for (const taskId of changes.canceled) {
        report += `- Task ${taskId} has been canceled\n`;
      }
      report += "\n";
    }

    if (changes.modified.length > 0) {
      report += "## Modified Tasks\n";
      for (const taskId of changes.modified) {
        report += `- Dependencies for task ${taskId} have been updated\n`;
      }
      report += "\n";
    }

    report +=
      "Please review the current task status and decide on next steps. You can:\n";
    report += "1. Create new tasks to replace canceled ones\n";
    report += "2. Proceed with the workflow using the modified dependencies\n";
    report +=
      "3. Provide a final response if enough information is available\n\n";
    report += "What would you like to do?";

    return report;
  }

  /**
   * Handles potential deadlock in task dependencies
   */
  private async handlePotentialDeadlock(
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): Promise<AgentResult> {
    if (this.verbose) {
      this._logVerbose(
        "\n⚠️ Potential deadlock detected in workflow. Requesting manager guidance..."
      );
    }

    // Check for repeated task failures with the same error pattern
    const failurePattern = this.detectRepeatedTaskFailurePattern(tasks);

    const deadlockedPrompt = `
There appears to be a deadlock or issue in the workflow. Some tasks may have dependencies that cannot be satisfied.

Current task status:
${[...tasks.values()]
  .map(
    (t) =>
      `- Task ${t.id} (${t.agentName}): ${t.status}, Dependencies: ${
        t.dependencies.join(", ") || "none"
      }${t.result ? `, Result: ${t.result.substring(0, 100)}${t.result.length > 100 ? "..." : ""}` : ""}`
  )
  .join("\n")}

${failurePattern ? `\n## DETECTED ISSUE\n${failurePattern}\n` : ""}

Please analyze the 'Current task status' CAREFULLY. Provide revised instructions to resolve this situation. Choose ONE of these options:

1. Create new tasks or revise existing task dependencies to continue the workflow.
   - When defining dependencies, you MUST use the exact task IDs (e.g., "task-0", "task-5") listed in the 'Current task status' for PREVIOUSLY COMPLETED tasks, or system-generated IDs for other tasks you are defining in THIS planning step, or "none".
   - If defining new tasks that depend on each other within this response, ensure your references are consistent for the system to map.
   - AVOID REDUNDANCY: Do not re-assign or re-create tasks that have already successfully completed (check 'Current task status'). Use their existing results instead of running them again, unless the goal or input parameters for that task have significantly changed.
   - Use the EXACT standard task assignment format:
     **Task #:** [Task title]
     **Team member:** [Team member name]
     **Why:** [Brief explanation]
     **Subtask:** [Clear description of what they need to do]
     **Depends on:** [Task ID(s) from 'Current task status' for PREVIOUSLY COMPLETED tasks, or system-generated IDs for other tasks you are defining in THIS planning step, or "none"]

2. If enough information is ALREADY AVAILABLE from COMPLETED tasks (check their 'result' in 'Current task status') to address the original user query, respond with "FINAL RESPONSE:" followed by your comprehensive final answer.
   - DO NOT state that data is missing if it exists in the 'result' of a completed task. UTILIZE THIS DATA.
   - DO NOT INVENT OR HALLUCINATE data values (e.g., incident counts). Use only data provided by previous agents or the original query. If critical data is genuinely missing AFTER checking all completed task results, you should prefer option 1 to create a task to retrieve it.

3. Cancel pending tasks that are causing the deadlock:
   - To cancel a task, use: "Cancel task: [task-id]"
   - You may cancel multiple tasks if needed.

4. Modify dependencies of existing tasks:
   - To modify dependencies, use: "Modify task: [task-id] depends on: [comma-separated task-ids or 'none']"
   - You may modify dependencies for multiple tasks.

5. Provide mock data for tool failures:
   - To overcome tool execution failures, use: "Mock data: [task-id] [JSON format data to simulate tool response]"
   - Use this option ONLY when there are persistent tool failures and progress is blocked.
   - Keep mock data realistic and minimal - only enough to continue the workflow.

IMPORTANT: If you choose option 2, start your message with "FINAL RESPONSE:" and provide a complete answer to the original task using ONLY confirmed information from COMPLETED TASKS.
`;

    const deadlockResult = await this.manager.run(deadlockedPrompt);
    conversationHistory.push(
      `Manager (Deadlock Resolution): ${deadlockResult.output}`
    );

    if (this.verbose) {
      this._logVerbose(
        `\n👨‍💼 Manager (Deadlock Resolution):\n${deadlockResult.output}\n`
      );
    }

    // Process any mock data responses from the manager
    this.processMockDataResponses(
      deadlockResult.output,
      tasks,
      conversationHistory
    );

    return deadlockResult;
  }

  /**
   * Detects repeated task failure patterns
   * @param tasks Map of all tasks
   * @returns A description of the detected issue, or null if none detected
   */
  private detectRepeatedTaskFailurePattern(
    tasks: Map<string, Task>
  ): string | null {
    const completedTasksByAgent = new Map<string, Task[]>();

    // Group completed tasks by agent
    for (const task of tasks.values()) {
      if (task.status === "completed") {
        if (!completedTasksByAgent.has(task.agentName)) {
          completedTasksByAgent.set(task.agentName, []);
        }
        completedTasksByAgent.get(task.agentName)?.push(task);
      }
    }

    // Check for repeated tool code patterns that might indicate failures
    for (const [agentName, agentTasks] of completedTasksByAgent.entries()) {
      if (agentTasks.length >= 2) {
        // Check if the same tool code keeps appearing in responses
        const toolCodePattern = this.detectRepeatedToolCodePattern(agentTasks);
        if (toolCodePattern) {
          return `Agent ${agentName} appears to be repeatedly providing the same tool code without successful execution. This may indicate a tool execution error or API limitation. Consider using mock data or modifying the approach.`;
        }
      }
    }

    return null;
  }

  /**
   * Detects repeated tool code patterns in task results
   * @param tasks Array of tasks from the same agent
   * @returns True if a repeated pattern is detected, false otherwise
   */
  private detectRepeatedToolCodePattern(tasks: Task[]): boolean {
    if (tasks.length < 2) return false;

    const toolCodeRegex = /```(?:tool_code|python)[\s\S]*?```/g;

    // Check the last 2 tasks' results
    const task1 = tasks[tasks.length - 1];
    const task2 = tasks[tasks.length - 2];

    if (!task1.result || !task2.result) return false;

    const toolCode1 = task1.result.match(toolCodeRegex);
    const toolCode2 = task2.result.match(toolCodeRegex);

    if (!toolCode1 || !toolCode2) return false;

    // Check if the tool code is very similar across tasks
    if (toolCode1.length > 0 && toolCode2.length > 0) {
      // Compare the first tool code block from each task
      const similarity = this.calculateSimilarity(toolCode1[0], toolCode2[0]);
      return similarity > 0.8; // If more than 80% similar, consider it a pattern
    }

    return false;
  }

  /**
   * Calculates string similarity between two strings
   * @param str1 First string
   * @param str2 Second string
   * @returns Similarity score between 0 and 1
   */
  private calculateSimilarity(str1: string, str2: string): number {
    // Simple similarity calculation based on length and character differences
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0; // Both strings are empty

    const minLength = Math.min(str1.length, str2.length);
    let sameChars = 0;

    // Count matching characters
    for (let i = 0; i < minLength; i++) {
      if (str1[i] === str2[i]) {
        sameChars++;
      }
    }

    return sameChars / maxLength;
  }

  /**
   * Process mock data responses from the manager
   * @param managerResponse The manager's response
   * @param tasks Map of all tasks
   * @param conversationHistory Conversation history array
   */
  private processMockDataResponses(
    managerResponse: string,
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): void {
    // Regex to match mock data directives
    const mockDataRegex = /Mock\s+data:\s+(task-\d+)\s+(\{[\s\S]*?\})/gi;
    let mockMatch: RegExpExecArray | null = mockDataRegex.exec(managerResponse);

    // Check for mock data directives
    while (mockMatch !== null) {
      const taskId = mockMatch[1];
      const mockDataJson = mockMatch[2];

      // Try to parse the JSON mock data
      try {
        const mockData = JSON.parse(mockDataJson);
        this.applyMockData(taskId, mockData, tasks, conversationHistory);
      } catch (error) {
        const message = `System: Error parsing mock data for task ${taskId}: ${error}`;
        conversationHistory.push(message);
        if (this.verbose) {
          this._logVerbose(`⚠️ ${message}`);
        }
      }

      // Get next match
      mockMatch = mockDataRegex.exec(managerResponse);
    }
  }

  /**
   * Apply mock data to a task
   * @param taskId The ID of the task to apply mock data to
   * @param mockData The mock data to apply
   * @param tasks Map of all tasks
   * @param conversationHistory Conversation history array
   */
  private applyMockData(
    taskId: string,
    mockData: any,
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): void {
    const task = tasks.get(taskId);

    if (!task) {
      const message = `System: Cannot apply mock data to task ${taskId} - task not found`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return;
    }

    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "canceled"
    ) {
      const message = `System: Cannot apply mock data to task ${taskId} - task is already ${task.status}`;
      conversationHistory.push(message);
      if (this.verbose) {
        this._logVerbose(`⚠️ ${message}`);
      }
      return;
    }

    // Create a formatted mock data result with both the original response (if any)
    // and the mock data clearly labeled
    let mockResult = "";
    if (task.result) {
      mockResult = `${task.result}\n\n---\n\n`;
    }

    mockResult += `SIMULATED TOOL RESPONSE (Manager-provided mock data):\n${JSON.stringify(mockData, null, 2)}`;

    // Update the task with the mock data
    task.result = mockResult;
    task.status = "completed";
    task.endTime = Date.now();

    const message = `System: Applied mock data to task ${taskId}`;
    conversationHistory.push(message);
    if (this.verbose) {
      this._logVerbose(`🔄 ${message}`);
    }
  }

  /**
   * Generates the final result from the team's work
   */
  private async generateFinalResult(
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): Promise<AgentResult> {
    if (this.verbose) {
      this._logVerbose("\n🏁 All tasks completed. Generating final result...");
    }

    const taskSummary = [...tasks.values()]
      .map((task) => {
        const executionTime =
          task.endTime && task.startTime
            ? `${((task.endTime - task.startTime) / 1000).toFixed(2)}s`
            : "N/A";

        return `- Task ${task.id} (${
          task.agentName
        }): ${task.status.toUpperCase()} ${executionTime}\n  ${
          task.description
        }\n  ${task.result || ""}\n`;
      })
      .join("\n");

    const finalPrompt = `
The team workflow is now COMPLETE. All assigned tasks have been finished, and NO MORE TASKS should be created.

Below is a summary of all completed tasks and their results:

${taskSummary}

## Instructions
- IMPORTANT: The workflow is COMPLETE. DO NOT create any new tasks. Your ONLY job now is to synthesize all the information from the 'taskSummary' into a FINAL RESPONSE to the original query.
- Based on all the work and responses from the team (detailed in 'taskSummary'), provide a comprehensive final response to the original task.
- Include key insights, conclusions, and recommendations gathered from all the completed tasks.
- Your response should come as is from you, do not make references to agents or internal task IDs, just provide the final answer as if you are directly answering the user.
- Your response should be the final deliverable to present to the user.
`;

    const finalResult = await this.manager.run(finalPrompt);
    conversationHistory.push(`Manager (Final): ${finalResult.output}`);

    if (this.verbose) {
      this._logVerbose(
        `\n👨‍💼 Manager (Final Summary):\n${finalResult.output}\n`
      );
      this._logVerbose("\n✅ Team execution completed successfully\n");
    }

    return finalResult;
  }

  /**
   * Extracts agent assignments from a manager message
   * This is a sophisticated implementation that extracts agent assignments,
   * including potential task dependencies and structured data.
   * @param managerMessage The message from the manager
   * @returns Array of agent assignments
   */
  private extractAgentAssignments(
    managerMessage: string
  ): Array<{ agentName: string; task: string }> {
    const assignments: Array<{ agentName: string; task: string }> = [];

    // Get all agent names
    const agentNames = Array.from(this.agents.keys());

    // Advanced regex-based parsing to find assignments
    for (const agentName of agentNames) {
      // Look for different assignment patterns
      const patterns = [
        // Direct assignment with colon
        new RegExp(
          `${agentName}:\\s*([^\\n]+(?:\\n(?!\\n|${agentNames.join(
            "|"
          )})[^\\n]+)*)`,
          "i"
        ),

        // Assignment with "assign to" format
        new RegExp(
          `assign\\s+${agentName}\\s+to\\s*:\\s*([^\\n]+(?:\\n(?!\\n|${agentNames.join(
            "|"
          )})[^\\n]+)*)`,
          "i"
        ),

        // "Should" directive format
        new RegExp(
          `${agentName}\\s+should\\s+([^\\n]+(?:\\n(?!\\n|${agentNames.join(
            "|"
          )})[^\\n]+)*)`,
          "i"
        ),

        // Task assignment with numbered format
        new RegExp(
          `task\\s+(?:for|to)\\s+${agentName}\\s*:\\s*([^\\n]+(?:\\n(?!\\n|${agentNames.join(
            "|"
          )})[^\\n]+)*)`,
          "i"
        ),

        // Markdown style with "Team member:" format
        new RegExp(
          `\\*\\*Team\\s+member:\\*\\*\\s*${agentName}[^\\n]*\\n(?:[^\\n]*\\n)*?\\*\\*Subtask:\\*\\*\\s*([^\\n]+(?:\\n(?!\\n|\\*\\*Team\\s+member)[^\\n]+)*)`,
          "i"
        ),

        // Direct mention in subtask
        new RegExp(
          `\\*\\*Subtask:\\*\\*\\s*${agentName},?\\s+([^\\n]+(?:\\n(?!\\n|\\*\\*)[^\\n]+)*)`,
          "i"
        ),
      ];

      for (const pattern of patterns) {
        const match = managerMessage.match(pattern);
        if (match?.[1]) {
          assignments.push({
            agentName,
            task: match[1].trim(),
          });
          break; // Found a match for this agent, move to the next one
        }
      }
    }

    return assignments;
  }

  /**
   * Checks for circular dependencies in the task graph
   * @param taskId The ID of the task to check
   * @param dependencies The dependencies of the task
   * @param tasks The existing task map
   * @returns Array of dependency cycles found, empty if none
   */
  private detectCircularDependencies(
    taskId: string,
    dependencies: string[],
    tasks: Map<string, Task>
  ): string[][] {
    const cycles: string[][] = [];

    // For each dependency, check if it forms a cycle
    for (const depId of dependencies) {
      // Skip non-existent dependencies
      if (!tasks.has(depId)) continue;

      // Check if the dependency directly or indirectly depends on this task
      const visited = new Set<string>();
      const path: string[] = [taskId, depId];

      // Run DFS to detect cycles
      this.detectCycleDFS(depId, taskId, tasks, visited, path, cycles);

      // If direct dependency creates a cycle, add it
      if (depId === taskId) {
        cycles.push([taskId, taskId]);
      }
    }

    return cycles;
  }

  /**
   * Helper for cycle detection using DFS
   */
  private detectCycleDFS(
    currentId: string,
    targetId: string,
    tasks: Map<string, Task>,
    visited: Set<string>,
    path: string[],
    cycles: string[][]
  ): boolean {
    // If we've already visited this node in this path, skip it
    if (visited.has(currentId)) return false;

    // Mark as visited
    visited.add(currentId);

    // Get the task's dependencies
    const task = tasks.get(currentId);
    if (!task) return false;

    for (const depId of task.dependencies) {
      // Found a cycle
      if (depId === targetId) {
        cycles.push([...path, targetId]);
        return true;
      }

      // Continue DFS if the dependency exists
      if (tasks.has(depId)) {
        path.push(depId);
        const found = this.detectCycleDFS(
          depId,
          targetId,
          tasks,
          visited,
          path,
          cycles
        );
        path.pop();

        // No need to check further dependencies if a cycle is found
        if (found) return true;
      }
    }

    return false;
  }
}
