import { AgentForgeEvents, type AgentResult } from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { RateLimiter, type RateLimiterOptions } from "../utils/rate-limiter";
import { enableConsoleStreaming } from "../utils/streaming";
import type { Agent, AgentRunOptions } from "./agent";

/**
 * Defines the structure of a task managed by the Team.
 */
interface Task {
  id: string;
  agentName: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  dependencies: string[]; // IDs of tasks that must be completed first
  result?: string; // Should this be string or any/unknown if tools return complex objects?
  startTime?: number;
  endTime?: number;
}

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

    if (this.verbose) {
      console.log(
        `\n🚀 Starting team execution with ${this.agents.size} agents and 1 manager`
      );
      console.log(`📋 Task: "${input}"\n`);
    }

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

## Team members
- Team members will be able to handle multiple tasks if needed.
- Team members will not talk between themselves, they will only do the tasks assigned to them.
- Always pass the required context to the team members.

**Available team members:**
${agentDescriptions}

## Format
**For each subtask, use this EXACT format:**
**Task #:** [Task title]
**Team member:** [Team member name]
**Why:** [Brief explanation]
**Subtask:** [Clear description of what they need to do]
**Depends on:** [Task ID(s) from 'Current task status' for PREVIOUSLY COMPLETED tasks, or system-generated IDs for other tasks you are defining in THIS planning step, or "none"]

**IMPORTANT:** Tasks will be processed in parallel unless you specify dependencies! For sequential tasks, you MUST use the "Depends on:" field.
**IMPORTANT:** Wait for each team member's response before proceeding with dependent tasks. When all subtasks are completed, provide a final response to the original task.
`;
    if (this.verbose) {
      console.log(`\n👨‍💼 Manager Prompt:\n${managerPrompt}\n`);
    }

    // If streaming is enabled, emit an event to indicate team is starting
    if (stream) {
      globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
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
        globalEventEmitter.emit(AgentForgeEvents.EXECUTION_COMPLETE, {
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
   * Internal method to run the team with the manager
   * @param managerPrompt The prompt for the manager
   * @returns The final result
   */
  private async runTeamWithManager(
    managerPrompt: string
  ): Promise<AgentResult> {
    // Get the initial plan from the manager
    const managerResult = await this.manager.run(managerPrompt);

    // Initialize conversation history to track the whole team interaction
    const conversationHistory: string[] = [`Manager: ${managerResult.output}`];

    // Task tracking
    const tasks: Map<string, Task> = new Map();
    const completedTasks: Set<string> = new Set();
    const failedTasks: Set<string> = new Set();
    let taskIdCounter = 0;

    // Extract initial tasks from the manager's response
    let currentManagerResponse = managerResult.output;
    const MAX_ITERATIONS = 10; // Increased for more complex workflows

    // Try to extract initial assignments or get explicit ones
    currentManagerResponse = await this.ensureTaskAssignments(
      currentManagerResponse,
      conversationHistory
    );

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Create new tasks from manager's assignments
      taskIdCounter = this.createTasksFromAssignments(
        currentManagerResponse,
        tasks,
        taskIdCounter,
        conversationHistory
      );

      // Find and execute ready tasks
      const results = await this.processReadyTasks(
        tasks,
        completedTasks,
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
          if (this.verbose) {
            console.log(
              "🔔 Manager indicated workflow completion. Finalizing..."
            );
          }
          break;
        }
      } else {
        // Handle cases with no ready tasks
        if (this.isWorkflowComplete(tasks)) {
          if (this.verbose) {
            console.log(
              "🔔 All tasks have been completed. Finalizing workflow..."
            );
          }
          break;
        }

        // Check for deadlocks and get manager guidance if needed
        const deadlockResult = await this.handlePotentialDeadlock(
          tasks,
          conversationHistory
        );

        currentManagerResponse = deadlockResult.output;

        if (this.isWorkflowCompletionMarked(currentManagerResponse)) {
          if (this.verbose) {
            console.log(
              "🔔 Manager resolved deadlock with workflow completion. Finalizing..."
            );
          }
          break;
        }
      }
    }

    // Generate final summary and result
    return await this.generateFinalResult(tasks, conversationHistory);
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
      if (this.verbose) {
        console.log(
          "🔄 No explicit task assignments found. Asking manager for clear assignments..."
        );
      }

      const explicitAssignmentPrompt = `
You need to assign specific tasks to team members to complete this work.

Please use this EXACT format for each task:
**Task #:** [Task title]
**Team member:** [Team member name]
**Why:** [Brief explanation]
**Subtask:** [Clear description of what they need to do]
**Depends on:** [Task ID(s) of dependencies separated by commas, e.g., "task-0, task-1" or write "none" if no dependencies]

**IMPORTANT:** Tasks will be processed in parallel unless you specify dependencies! For sequential tasks, you MUST use the "Depends on:" field.

What tasks would you like to assign to each team member?
`;
      const explicitAssignmentResult = await this.manager.run(
        `${currentResponse}\n\n${explicitAssignmentPrompt}`
      );

      const newResponse = explicitAssignmentResult.output;
      conversationHistory.push(`Manager (Task Assignment): ${newResponse}`);

      if (this.verbose) {
        console.log(`\n👨‍💼 Manager (Task Assignment):\n${newResponse}\n`);
      }

      return newResponse;
    }

    if (this.verbose && initialAssignments.length > 0) {
      console.log(`\n👨‍💼 Manager (Initial Plan):\n${currentResponse}\n`);
      console.log(
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
        console.log(`🔍 Found ${rawAssignments.length} task assignments:`);
        for (const assignment of rawAssignments) {
          console.log(
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
      console.log(`📋 Current task status (${tasks.size} total tasks):`);
      for (const [taskId, task] of tasks.entries()) {
        console.log(
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
      console.log(
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

    for (const assignment of assignments) {
      const { agentName, task: description } = assignment;

      // Skip if agent doesn't exist
      if (!this.agents.has(agentName)) {
        this.logSkippedTask(agentName, conversationHistory);
        continue;
      }

      const taskId = `task-${counter++}`;
      const dependencies = this.extractDependenciesFromDescription(description);

      tasks.set(taskId, {
        id: taskId,
        agentName,
        description,
        status: "pending",
        dependencies,
      });

      this.logTaskCreation(
        taskId,
        agentName,
        description,
        conversationHistory,
        false,
        dependencies
      );
    }

    return counter;
  }

  /**
   * Extracts task dependencies from a task description
   */
  private extractDependenciesFromDescription(description: string): string[] {
    // Look for dependencies in the original format
    const oldFormatMatch = description.match(/depends on:\s*(task-[\d,\s]+)/i);

    if (oldFormatMatch) {
      return oldFormatMatch[1].split(",").map((id) => id.trim());
    }

    // Look for dependencies in the new structured format
    const newFormatMatch = description.match(
      /\*\*Depends on:\*\*\s*(task-[\d,\s]+|none)/i
    );

    if (newFormatMatch) {
      const dependsOn = newFormatMatch[1].trim().toLowerCase();
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
      ? `System: Created default task ${taskId} for ${agentName}: ${description.substring(
          0,
          100
        )}...`
      : `System: Created task ${taskId} for ${agentName}: ${description}`;

    conversationHistory.push(logMessage);

    if (this.verbose) {
      const icon = isDefault ? "🤖" : "🔄";
      console.log(
        `${icon} System: Created task ${taskId} for ${agentName}: ${description.substring(
          0,
          100
        )}${description.length > 100 ? "..." : ""}`
      );

      if (dependencies.length > 0) {
        console.log(`📌 Dependencies: ${dependencies.join(", ")}`);
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
      console.log(`⚠️ ${message}`);
    }
  }

  /**
   * Processes and executes tasks that are ready to run
   */
  private async processReadyTasks(
    tasks: Map<string, Task>,
    completedTasks: Set<string>,
    failedTasks: Set<string>,
    conversationHistory: string[]
  ): Promise<Task[]> {
    // Process ready tasks (no dependencies or all dependencies completed)
    const readyTasks = this.findReadyTasks(tasks, completedTasks);

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
  private findReadyTasks(
    tasks: Map<string, Task>,
    completedTasks: Set<string>
  ): Task[] {
    const readyTasks: Task[] = [];

    for (const task of tasks.values()) {
      if (task.status === "pending") {
        const allDependenciesMet = task.dependencies.every((depId: string) =>
          completedTasks.has(depId)
        );

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

    // Format the task for the agent
    const formattedTask = `
Task: ${task.description}

${
  task.dependencies && task.dependencies.length > 0
    ? `This task depends on previous work: ${task.dependencies.join(", ")}`
    : ""
}

Please provide a clear and detailed response.
`;

    // Get stream option from team options
    const stream = this.options?.stream || false;

    // If streaming, emit event that agent is starting only once
    if (stream) {
      globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: "Manager",
        recipient: agentName,
        message: `I'm assigning you the following task: ${task.description}`,
        timestamp: Date.now(),
      });
    }

    // Execute the agent with streaming if enabled
    const agentResult = await agent.run(formattedTask, { stream });

    // Update the task with the result
    task.result = agentResult.output;
    task.status = "completed";
    task.endTime = Date.now();

    // Add the result to the conversation history only once
    conversationHistory.push(`${agentName}: ${agentResult.output}`);

    // If streaming, emit task completion event only once
    if (stream) {
      globalEventEmitter.emit(AgentForgeEvents.TEAM_TASK_COMPLETE, {
        taskId: task.id,
        agentName: task.agentName,
        description: task.description,
        result: agentResult.output,
      });

      // Also emit agent communication for manager - only once
      globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: agentName,
        recipient: "Manager",
        message: agentResult.output,
        timestamp: Date.now(),
      });
    }

    return task;
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
      globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
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

    // Check if all tasks are either completed or failed
    const allTasksFinished = [...tasks.values()].every(
      (t) => t.status === "completed" || t.status === "failed"
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
   * Handles potential deadlock in task dependencies
   */
  private async handlePotentialDeadlock(
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): Promise<AgentResult> {
    if (this.verbose) {
      console.log(
        "\n⚠️ Potential deadlock detected in workflow. Requesting manager guidance..."
      );
    }

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

IMPORTANT: If you choose option 2, start your message with "FINAL RESPONSE:" and provide a complete answer to the original task using ONLY confirmed information from COMPLETED TASKS.
`;

    const deadlockResult = await this.manager.run(deadlockedPrompt);
    conversationHistory.push(
      `Manager (Deadlock Resolution): ${deadlockResult.output}`
    );

    if (this.verbose) {
      console.log(
        `\n👨‍💼 Manager (Deadlock Resolution):\n${deadlockResult.output}\n`
      );
    }

    return deadlockResult;
  }

  /**
   * Generates the final result from the team's work
   */
  private async generateFinalResult(
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): Promise<AgentResult> {
    if (this.verbose) {
      console.log("\n🏁 All tasks completed. Generating final result...");
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
      console.log(`\n👨‍💼 Manager (Final Summary):\n${finalResult.output}\n`);
      console.log("\n✅ Team execution completed successfully\n");
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
}
