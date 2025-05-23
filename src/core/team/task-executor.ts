import type { AgentResult, Task, TeamRunOptions } from "../../types";
import { AgentForgeEvents } from "../../types";
import { globalEventEmitter } from "../../utils/event-emitter";
import type { Agent } from "../agent";
import type { AgentInteractionHelper } from "./agent-interaction-helper";

export class TaskExecutor {
  private agents: Map<string, Agent>;
  private agentInteractionHelper: AgentInteractionHelper;
  private options?: TeamRunOptions;
  private tasks?: Map<string, Task>;
  private verbose: boolean;
  private stream: boolean;
  private logVerbose: (message: string, icon?: string) => void;
  private emitStreamEvent: (eventName: AgentForgeEvents, payload: any) => void;

  constructor(
    agents: Map<string, Agent>,
    agentInteractionHelper: AgentInteractionHelper,
    logVerbose: (message: string, icon?: string) => void,
    emitStreamEvent: (eventName: AgentForgeEvents, payload: any) => void,
    options: TeamRunOptions | undefined,
    tasks: Map<string, Task> | undefined
  ) {
    this.agents = agents;
    this.agentInteractionHelper = agentInteractionHelper;
    this.options = options;
    this.tasks = tasks;
    this.logVerbose = logVerbose;
    this.emitStreamEvent = emitStreamEvent;

    this.verbose = this.options?.verbose || false;
    this.stream = this.options?.stream || false;
  }

  public async executeTask(
    task: Task,
    conversationHistory: string[]
  ): Promise<Task> {
    const agentName = task.agentName;
    const agent = this.agents.get(agentName);

    if (!agent) {
      throw new Error(`Agent '${agentName}' not found in team`);
    }

    const dependencyResults =
      this.agentInteractionHelper.collectDependencyResults(
        task,
        this.tasks || new Map()
      );
    const formattedTask = this.agentInteractionHelper.formatTaskForAgent(
      task,
      dependencyResults
    );

    if (this.stream) {
      this.emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: "Manager",
        recipient: agentName,
        message: `I\'m assigning you the following task: ${task.description}`,
        timestamp: Date.now(),
      });
    }

    try {
      const agentResult = await agent.run(formattedTask, {
        stream: this.stream,
      });

      const containsUnexecutedToolCode =
        this.agentInteractionHelper.detectUnexecutedToolCode(
          agentResult.output
        );
      const hasTools = this.agentInteractionHelper.agentHasTools(agent);

      if (containsUnexecutedToolCode && hasTools) {
        task.result =
          await this.agentInteractionHelper.handleUnexecutedToolCode(
            task,
            agent,
            agentResult,
            this.stream
          );
      } else {
        task.result = agentResult.output;
      }
      task.status = task.status === "failed" ? "failed" : "completed";
    } catch (error) {
      task.result = `Error executing task: ${error}`;
      task.status = "failed";
      if (this.verbose) {
        this.logVerbose(`❌ Error executing task ${task.id}: ${error}`);
      }
    }

    task.endTime = Date.now();
    conversationHistory.push(`${agentName}: ${task.result}`);

    if (this.stream) {
      this.emitStreamEvent(AgentForgeEvents.TEAM_TASK_COMPLETE, {
        taskId: task.id,
        agentName: task.agentName,
        description: task.description,
        result: task.result,
      });
      this.emitStreamEvent(AgentForgeEvents.AGENT_COMMUNICATION, {
        sender: agentName,
        recipient: "Manager",
        message: task.result,
        timestamp: Date.now(),
      });
    }
    return task;
  }
}
