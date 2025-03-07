import type { AgentResult } from "../types";
import type { Agent } from "./agent";

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
}

/**
 * Represents a team of agents with a manager
 */
export class Team {
  private manager: Agent;
  private agents: Map<string, Agent> = new Map();
  private name: string;
  private description: string;
  private rateLimiter?: {
    tokensRemaining: number;
    lastResetTime: number;
    waitingQueue: Array<() => void>;
  };
  private verbose = false;

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
    // Reset all agent conversations
    this.reset();

    // Set verbose mode if specified
    this.verbose = options?.verbose || false;

    // Initialize rate limiter if needed
    if (options?.rate_limit) {
      this.setupRateLimiter(options.rate_limit);
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
Task: ${input}

You are the manager of a team. Your role is to analyze the task and decide which team member(s) should handle it.
The task will be broken down into subtasks as needed, and assigned to the appropriate team member.

Available team members:
${agentDescriptions}

For each subtask:
1. Choose the most appropriate team member
2. Explain why you chose them
3. Clearly describe the subtask they need to complete
4. Wait for their response before proceeding

You'll receive responses from team members as they complete their assigned subtasks.
When all subtasks are completed, provide a final comprehensive response to the original task.
`;

    try {
      // Run the manager agent to orchestrate the team
      return await this.runTeamWithManager(managerPrompt);
    } finally {
      // Clean up the rate limiter
      this.rateLimiter = undefined;
    }
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

    // Patch the run method of all agents to respect rate limiting
    const originalManagerRun = this.manager.run;
    this.manager.run = async (input: string, maxTurns?: number) => {
      await this.waitForRateLimit();
      return originalManagerRun.call(this.manager, input, maxTurns);
    };

    for (const agent of this.agents.values()) {
      const originalAgentRun = agent.run;
      agent.run = async (input: string, maxTurns?: number) => {
        await this.waitForRateLimit();
        return originalAgentRun.call(agent, input, maxTurns);
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

      // Process waiting queue
      while (
        this.rateLimiter.tokensRemaining > 0 &&
        this.rateLimiter.waitingQueue.length > 0
      ) {
        const resolve = this.rateLimiter.waitingQueue.shift();
        if (resolve) {
          this.rateLimiter.tokensRemaining--;
          resolve();
        }
      }
    }

    // If we have tokens available, use one and proceed
    if (this.rateLimiter.tokensRemaining > 0) {
      this.rateLimiter.tokensRemaining--;
      return;
    }

    // Otherwise, wait for a token to become available
    return new Promise<void>((resolve) => {
      if (this.rateLimiter) {
        this.rateLimiter.waitingQueue.push(resolve);

        // Calculate when the next token will be available
        const timeUntilReset = 60000 - (now - this.rateLimiter.lastResetTime);

        // Log waiting message if queue is getting long
        if (this.rateLimiter.waitingQueue.length > 3) {
          console.log(
            `Rate limit reached. Waiting ${Math.ceil(
              timeUntilReset / 1000
            )}s for next available slot. ${
              this.rateLimiter.waitingQueue.length
            } calls in queue.`
          );
        }
      } else {
        // If rate limiter was removed during execution, resolve immediately
        resolve();
      }
    });
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

    // Enhanced task management structures
    interface Task {
      id: string;
      agentName: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      dependencies: string[]; // IDs of tasks that must be completed first
      result?: string;
      startTime?: number;
      endTime?: number;
    }

    // Task tracking
    const tasks: Map<string, Task> = new Map();
    const completedTasks: Set<string> = new Set();
    const failedTasks: Set<string> = new Set();
    const taskIdCounter = 0;

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
      this.createTasksFromAssignments(
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
        if (currentManagerResponse.includes("WORKFLOW COMPLETE")) {
          break;
        }
      } else {
        // Handle cases with no ready tasks
        if (this.isWorkflowComplete(tasks)) {
          break;
        }

        // Check for deadlocks and get manager guidance if needed
        const deadlockResult = await this.handlePotentialDeadlock(
          tasks,
          conversationHistory
        );

        currentManagerResponse = deadlockResult.output;

        if (currentManagerResponse.includes("WORKFLOW COMPLETE")) {
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

Please explicitly assign tasks using the format:
"[AgentName]: [Task description]" or "Assign [AgentName] to: [Task description]"

For example:
Researcher: Research the basics of quantum computing and its current state.
Assign Summarizer to: Create a concise summary of the implications for cybersecurity.

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
    tasks: Map<string, any>,
    taskIdCounter: number,
    conversationHistory: string[]
  ): number {
    const rawAssignments = this.extractAgentAssignments(managerResponse);
    let counter = taskIdCounter;

    // If no assignments found after explicit prompt, create default tasks for all agents
    if (rawAssignments.length === 0 && tasks.size === 0) {
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

        conversationHistory.push(
          `System: Created default task ${taskId} for ${
            agent.name
          }: ${description.substring(0, 100)}...`
        );

        if (this.verbose) {
          console.log(
            `🤖 System: Created default task ${taskId} for ${agent.name}`
          );
        }
      }
    } else {
      // Process new tasks from the manager
      for (const assignment of rawAssignments) {
        const { agentName, task: description } = assignment;

        // Skip if agent doesn't exist
        if (!this.agents.has(agentName)) {
          conversationHistory.push(
            `System: Agent "${agentName}" does not exist. Task skipped.`
          );

          if (this.verbose) {
            console.log(
              `⚠️ System: Agent "${agentName}" does not exist. Task skipped.`
            );
          }

          continue;
        }

        // Create a unique ID for this task
        const taskId = `task-${counter++}`;

        // Extract dependencies from task description if present
        // Format: "Depends on: task-0, task-1"
        const dependencyMatch = description.match(
          /depends on:\s*(task-[\d,\s]+)/i
        );
        const dependencies = dependencyMatch
          ? dependencyMatch[1].split(",").map((id) => id.trim())
          : [];

        // Store the task
        tasks.set(taskId, {
          id: taskId,
          agentName,
          description,
          status: "pending",
          dependencies,
        });

        // Log the new task
        conversationHistory.push(
          `System: Created task ${taskId} for ${agentName}: ${description}`
        );

        if (this.verbose) {
          console.log(
            `🔄 System: Created task ${taskId} for ${agentName}: ${description.substring(
              0,
              100
            )}${description.length > 100 ? "..." : ""}`
          );
          if (dependencies.length > 0) {
            console.log(`📌 Dependencies: ${dependencies.join(", ")}`);
          }
        }
      }
    }

    return counter;
  }

  /**
   * Processes and executes tasks that are ready to run
   */
  private async processReadyTasks(
    tasks: Map<string, any>,
    completedTasks: Set<string>,
    failedTasks: Set<string>,
    conversationHistory: string[]
  ): Promise<any[]> {
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
      this.executeTask(
        task,
        tasks,
        completedTasks,
        failedTasks,
        conversationHistory
      )
    );

    // Wait for all tasks to complete
    return await Promise.all(taskPromises);
  }

  /**
   * Finds tasks that are ready to execute
   */
  private findReadyTasks(
    tasks: Map<string, any>,
    completedTasks: Set<string>
  ): any[] {
    const readyTasks: any[] = [];

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
    tasks: Map<string, any>,
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
    task: any,
    tasks: Map<string, any>,
    completedTasks: Set<string>,
    failedTasks: Set<string>,
    conversationHistory: string[]
  ): Promise<any> {
    try {
      if (this.verbose) {
        console.log(
          `\n⏳ Starting task ${task.id} for agent "${task.agentName}"...`
        );
      }

      // Build context for the agent based on dependencies
      let taskContext = `Your task: ${task.description}\n\n`;

      // Add relevant context from completed dependent tasks
      if (task.dependencies.length > 0) {
        taskContext += "Context from previous tasks:\n";
        for (const depId of task.dependencies) {
          const depTask = tasks.get(depId);
          if (depTask?.result) {
            taskContext += `- Task ${depId} (${depTask.agentName}): ${depTask.result}\n`;
          }
        }
        taskContext += "\n";
      }

      // Execute the agent
      const agent = this.agents.get(task.agentName);
      if (!agent) {
        throw new Error(`Agent ${task.agentName} not found`);
      }
      const agentResult = await agent.run(taskContext);

      // Record the results
      task.status = "completed";
      task.result = agentResult.output;
      task.endTime = Date.now();
      completedTasks.add(task.id);

      // Log completion
      conversationHistory.push(
        `${task.agentName} (Task ${task.id}): ${agentResult.output}`
      );

      if (this.verbose) {
        console.log(
          `\n👤 ${task.agentName} (Task ${task.id}):\n${agentResult.output}\n`
        );
        console.log(
          `✅ Task ${task.id} completed in ${(
            (task.endTime - task.startTime) /
            1000
          ).toFixed(2)}s`
        );
      }

      return {
        taskId: task.id,
        agentName: task.agentName,
        result: agentResult.output,
      };
    } catch (error) {
      // Handle errors
      task.status = "failed";
      task.result = `Error: ${
        error instanceof Error ? error.message : String(error)
      }`;
      task.endTime = Date.now();
      failedTasks.add(task.id);

      // Log failure
      conversationHistory.push(
        `System: Task ${task.id} for ${task.agentName} failed with error: ${task.result}`
      );

      if (this.verbose) {
        console.log(
          `\n❌ System: Task ${task.id} for ${task.agentName} failed with error: ${task.result}`
        );
      }

      return {
        taskId: task.id,
        agentName: task.agentName,
        error: task.result,
      };
    }
  }

  /**
   * Generates progress report for completed tasks
   */
  private generateProgressReport(
    results: any[],
    tasks: Map<string, any>
  ): string {
    let progressReport = "Task Progress Report:\n";

    // Completed tasks in this batch
    progressReport += "\nCompleted Tasks:\n";
    for (const result of results.filter((r) => !r.error)) {
      progressReport += `- Task ${result.taskId} (${result.agentName}): ${result.result}\n`;
    }

    // Failed tasks in this batch
    const failedResults = results.filter((r) => r.error);
    if (failedResults.length > 0) {
      progressReport += "\nFailed Tasks:\n";
      for (const result of failedResults) {
        progressReport += `- Task ${result.taskId} (${result.agentName}): ${result.error}\n`;
      }
    }

    // Pending tasks
    const pendingTasksCount = [...tasks.values()].filter(
      (t) => t.status === "pending"
    ).length;
    if (pendingTasksCount > 0) {
      progressReport += `\nPending Tasks: ${pendingTasksCount}\n`;
    }

    return progressReport;
  }

  /**
   * Gets next instructions from the manager based on progress
   */
  private async getNextManagerInstructions(
    progressReport: string,
    conversationHistory: string[]
  ): Promise<any> {
    if (this.verbose) {
      console.log(`\n📊 Progress Report:\n${progressReport}`);
      console.log("\n🔄 Getting manager's next instructions...");
    }

    const managerPromptWithProgress = `
Here is a progress report on the team's work:

${progressReport}

Based on this progress, please provide:
1. Any additional tasks that need to be assigned
2. Guidance on next steps
3. If all essential work is complete, say "WORKFLOW COMPLETE" and provide a final assessment
`;

    const nextManagerResult = await this.manager.run(managerPromptWithProgress);
    conversationHistory.push(`Manager: ${nextManagerResult.output}`);

    if (this.verbose) {
      console.log(`\n👨‍💼 Manager:\n${nextManagerResult.output}\n`);
    }

    return nextManagerResult;
  }

  /**
   * Checks if the workflow is complete
   */
  private isWorkflowComplete(tasks: Map<string, any>): boolean {
    return [...tasks.values()].every(
      (t) => t.status === "completed" || t.status === "failed"
    );
  }

  /**
   * Handles potential deadlock in task dependencies
   */
  private async handlePotentialDeadlock(
    tasks: Map<string, any>,
    conversationHistory: string[]
  ): Promise<any> {
    if (this.verbose) {
      console.log(
        "\n⚠️ Potential deadlock detected in workflow. Requesting manager guidance..."
      );
    }

    const deadlockedPrompt = `
There appears to be a deadlock in the workflow. Some tasks have dependencies that cannot be satisfied.

Current task status:
${[...tasks.values()]
  .map(
    (t) =>
      `- Task ${t.id} (${t.agentName}): ${t.status}, Dependencies: ${
        t.dependencies.join(", ") || "none"
      }`
  )
  .join("\n")}

Please provide revised instructions to resolve this situation. You can:
1. Cancel pending tasks that are no longer needed
2. Create new tasks with adjusted dependencies
3. Decide if we have enough information to finish the workflow (mark with "WORKFLOW COMPLETE")
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
    tasks: Map<string, any>,
    conversationHistory: string[]
  ): Promise<any> {
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
The team has completed its work on the task. Below is a summary of all tasks and their results:

${taskSummary}

Based on all the work and responses from the team, please provide a final comprehensive response to the original task.
Include key insights, conclusions, and recommendations.
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
