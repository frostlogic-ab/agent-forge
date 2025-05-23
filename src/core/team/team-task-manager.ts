import type { Task } from "../../types";
import type { Agent } from "../agent";
import type { AgentAssignment } from "./manager-response-parser";
import type { ManagerResponseParser } from "./manager-response-parser";
import type { TeamDependencyGraph } from "./team-dependency-graph";
// Potentially import ManagerResponseParser and TeamDependencyGraph later

export class TeamTaskManager {
  private managerResponseParser: ManagerResponseParser;
  private agents: Map<string, Agent>;
  private teamDependencyGraph: TeamDependencyGraph;
  private verbose: boolean;

  constructor(
    managerResponseParser: ManagerResponseParser,
    agents: Map<string, Agent>,
    teamDependencyGraph: TeamDependencyGraph,
    verbose: boolean
  ) {
    this.managerResponseParser = managerResponseParser;
    this.agents = agents;
    this.teamDependencyGraph = teamDependencyGraph;
    this.verbose = verbose;
  }

  public createTasksFromAssignments(
    managerResponse: string,
    tasks: Map<string, Task>,
    taskIdCounter: number,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void
  ): number {
    const rawAssignments =
      this.managerResponseParser.extractAgentAssignments(managerResponse);
    let counter = taskIdCounter;

    if (rawAssignments.length === 0 && tasks.size === 0) {
      counter = this.createDefaultTasksForAllAgents(
        managerResponse,
        tasks,
        counter,
        conversationHistory,
        logVerbose
      );
    } else {
      if (this.verbose && rawAssignments.length > 0) {
        logVerbose(`🔍 Found ${rawAssignments.length} task assignments:`);
        for (const assignment of rawAssignments) {
          logVerbose(
            `- ${assignment.agentName}: ${assignment.task.substring(0, 50)}...`
          );
        }
      }

      counter = this.processAssignedTasks(
        rawAssignments,
        tasks,
        counter,
        conversationHistory,
        logVerbose
      );
    }

    if (this.verbose) {
      logVerbose(`📋 Current task status (${tasks.size} total tasks):`);
      for (const [taskId, task] of tasks.entries()) {
        logVerbose(
          `- ${taskId} (${task.agentName}): ${task.status}, Dependencies: ${task.dependencies.join(", ") || "none"}`
        );
      }
    }
    return counter;
  }

  private createDefaultTasksForAllAgents(
    managerResponse: string,
    tasks: Map<string, Task>,
    taskIdCounter: number,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void
  ): number {
    let counter = taskIdCounter;
    if (this.verbose) {
      logVerbose(
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
        logVerbose,
        true
      );
    }
    return counter;
  }

  private processAssignedTasks(
    assignments: AgentAssignment[],
    tasks: Map<string, Task>,
    taskIdCounter: number,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void
  ): number {
    let counter = taskIdCounter;
    const agentsWithPendingTasks = new Set<string>();
    for (const task of tasks.values()) {
      if (task.status === "pending" || task.status === "in_progress") {
        agentsWithPendingTasks.add(task.agentName);
      }
    }

    for (const assignment of assignments) {
      const { agentName, task: description } = assignment;
      if (!this.agents.has(agentName)) {
        this.logSkippedTask(agentName, conversationHistory, logVerbose);
        continue;
      }

      if (agentsWithPendingTasks.has(agentName)) {
        const message = `System: Skipped duplicate task assignment for ${agentName} who already has a pending task`;
        conversationHistory.push(message);
        if (this.verbose) {
          logVerbose(`⚠️ ${message}`);
        }
        continue;
      }

      agentsWithPendingTasks.add(agentName);
      const taskId = `task-${counter++}`;
      const dependencies =
        this.managerResponseParser.extractDependenciesFromDescription(
          description
        ); // Use parser

      const filteredDependencies = dependencies.filter((dep) => dep !== taskId);
      if (filteredDependencies.length !== dependencies.length) {
        const message = `System: Warning - Removed self-dependency from task ${taskId}`;
        conversationHistory.push(message);
        if (this.verbose) {
          logVerbose(`⚠️ ${message}`);
        }
      }

      tasks.set(taskId, {
        id: taskId,
        agentName,
        description,
        status: "pending",
        dependencies: filteredDependencies,
      });

      const cycles = this.teamDependencyGraph.detectCircularDependencies(
        taskId,
        filteredDependencies,
        tasks
      );

      if (cycles.length > 0) {
        const cyclicDeps = new Set<string>();
        for (const cycle of cycles) {
          for (const dep of cycle) {
            if (dep !== taskId && filteredDependencies.includes(dep)) {
              cyclicDeps.add(dep);
            }
          }
        }
        const safeDepList = filteredDependencies.filter(
          (dep) => !cyclicDeps.has(dep)
        );
        const taskToUpdate = tasks.get(taskId);
        if (taskToUpdate) {
          taskToUpdate.dependencies = safeDepList;
        }
        const message = `System: Warning - Removed cyclic dependencies ${Array.from(cyclicDeps).join(", ")} from task ${taskId}`;
        conversationHistory.push(message);
        if (this.verbose) {
          logVerbose(`⚠️ ${message}`);
        }
        this.logTaskCreation(
          taskId,
          agentName,
          description,
          conversationHistory,
          logVerbose,
          false,
          safeDepList
        );
      } else {
        this.logTaskCreation(
          taskId,
          agentName,
          description,
          conversationHistory,
          logVerbose,
          false,
          filteredDependencies
        );
      }
    }
    return counter;
  }

  private logTaskCreation(
    taskId: string,
    agentName: string,
    description: string,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void, // Added logVerbose
    isDefault = false,
    dependencies: string[] = []
  ): void {
    const logMessage = isDefault
      ? `System: Created default task ${taskId} for ${agentName}: ${description}...`
      : `System: Created task ${taskId} for ${agentName}: ${description}`;
    conversationHistory.push(logMessage);
    if (this.verbose) {
      const icon = isDefault ? "🤖" : "🔄";
      logVerbose(
        `${icon} System: Created task ${taskId} for ${agentName}: ${description.substring(0, 100)}${description.length > 100 ? "..." : ""}`
      );
      if (dependencies.length > 0) {
        logVerbose(`📌 Dependencies: ${dependencies.join(", ")}`);
      }
    }
  }

  private logSkippedTask(
    agentName: string,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void // Added logVerbose
  ): void {
    const message = `System: Agent "${agentName}" does not exist. Task skipped.`;
    conversationHistory.push(message);
    if (this.verbose) {
      logVerbose(`⚠️ ${message}`);
    }
  }

  public processTaskChanges(
    managerResponse: string,
    tasks: Map<string, Task>,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void
  ): { modified: string[]; canceled: string[] } | null {
    const modified: string[] = [];
    const canceled: string[] = [];
    let changesMade = false;

    const cancelPattern = /Cancel\s+task:\s+(task-\d+)/gi;
    let cancelMatch: RegExpExecArray | null =
      cancelPattern.exec(managerResponse);

    while (cancelMatch !== null) {
      const taskId = cancelMatch[1];
      const taskCanceled = this.cancelTask(
        taskId,
        tasks,
        conversationHistory,
        logVerbose
      );
      if (taskCanceled) {
        changesMade = true;
        canceled.push(taskId);
      }
      cancelMatch = cancelPattern.exec(managerResponse);
    }

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
        conversationHistory,
        logVerbose
      );
      if (taskModified) {
        changesMade = true;
        modified.push(taskId);
      }
      modifyMatch = modifyPattern.exec(managerResponse);
    }

    return changesMade ? { modified, canceled } : null;
  }

  public cancelTask(
    taskId: string,
    tasks: Map<string, Task>,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void
  ): boolean {
    const task = tasks.get(taskId);
    if (!task) {
      const message = `System: Cannot cancel task ${taskId} - task not found`;
      conversationHistory.push(message);
      if (this.verbose) {
        logVerbose(`⚠️ ${message}`);
      }
      return false;
    }
    if (task.status === "in_progress" || task.status === "completed") {
      const message = `System: Cannot cancel task ${taskId} - task is already ${task.status}`;
      conversationHistory.push(message);
      if (this.verbose) {
        logVerbose(`⚠️ ${message}`);
      }
      return false;
    }
    task.status = "canceled";
    task.endTime = Date.now();
    const message = `System: Successfully canceled task ${taskId}`;
    conversationHistory.push(message);
    if (this.verbose) {
      logVerbose(`🚫 ${message}`);
    }
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
          logVerbose(`⛔ ${failMessage}`);
        }
      }
    }
    return true;
  }

  public modifyTaskDependencies(
    taskId: string,
    newDependencies: string[],
    tasks: Map<string, Task>,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void
  ): boolean {
    const task = tasks.get(taskId);
    if (!task) {
      const message = `System: Cannot modify task ${taskId} - task not found`;
      conversationHistory.push(message);
      if (this.verbose) {
        logVerbose(`⚠️ ${message}`);
      }
      return false;
    }
    if (task.status !== "pending") {
      const message = `System: Cannot modify dependencies of task ${taskId} - task is already ${task.status}`;
      conversationHistory.push(message);
      if (this.verbose) {
        logVerbose(`⚠️ ${message}`);
      }
      return false;
    }
    const missingDeps = newDependencies.filter((depId) => !tasks.has(depId));
    if (missingDeps.length > 0) {
      const message = `System: Cannot modify dependencies of task ${taskId} - dependencies not found: ${missingDeps.join(", ")}`;
      conversationHistory.push(message);
      if (this.verbose) {
        logVerbose(`⚠️ ${message}`);
      }
      return false;
    }
    const cycles = this.teamDependencyGraph.detectCircularDependencies(
      taskId,
      newDependencies,
      tasks
    );
    if (cycles.length > 0) {
      const message = `System: Cannot modify dependencies of task ${taskId} - would create circular dependencies`;
      conversationHistory.push(message);
      if (this.verbose) {
        logVerbose(`⚠️ ${message}`);
        for (const cycle of cycles) {
          logVerbose(`  Cycle: ${cycle.join(" -> ")}`);
        }
      }
      return false;
    }
    const oldDeps = task.dependencies;
    task.dependencies = newDependencies;
    const modifiedMessage = `System: Successfully modified dependencies of task ${taskId} from [${oldDeps.join(", ") || "none"}] to [${newDependencies.join(", ") || "none"}]`;
    conversationHistory.push(modifiedMessage);
    if (this.verbose) {
      logVerbose(`🔄 ${modifiedMessage}`);
    }
    return true;
  }

  public findReadyTasks(tasks: Map<string, Task>): Task[] {
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

  public handleTasksWithFailedDependencies(
    tasks: Map<string, Task>,
    failedTasks: Set<string>,
    conversationHistory: string[],
    logVerbose: (message: string, icon?: string) => void // Added logVerbose
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
          if (this.verbose) {
            // Use this.verbose for conditional logging
            logVerbose(
              `⛔ System: Task ${task.id} for ${task.agentName} failed due to failed dependencies.`
            );
          }
          pendingTasksWithFailedDeps = true;
        }
      }
    }
    return pendingTasksWithFailedDeps;
  }
}
