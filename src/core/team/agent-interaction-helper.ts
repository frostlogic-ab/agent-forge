import type { AgentResult, Task } from "../../types";
import { AgentForgeEvents } from "../../types";
import { globalEventEmitter } from "../../utils/event-emitter";
import type { Agent } from "../agent";

export class AgentInteractionHelper {
  private logVerbose: (message: string, icon?: string) => void;
  private verbose: boolean;

  constructor(
    logVerbose: (message: string, icon?: string) => void,
    verbose: boolean
  ) {
    this.logVerbose = logVerbose;
    this.verbose = verbose;
  }

  /**
   * Collects results from dependency tasks.
   * @param task The current task.
   * @param allTasks A map of all tasks in the current execution context.
   * @returns An array of dependency results.
   */
  public collectDependencyResults(
    task: Task,
    allTasks: Map<string, Task>
  ): { taskId: string; result: string }[] {
    if (this.verbose)
      this.logVerbose(
        "AgentInteractionHelper.collectDependencyResults called."
      );
    const dependencyResults: { taskId: string; result: string }[] = [];
    for (const depId of task.dependencies) {
      const depTask = allTasks.get(depId);
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
  public formatTaskForAgent(
    task: Task,
    dependencyResults: { taskId: string; result: string }[]
  ): string {
    if (this.verbose)
      this.logVerbose("AgentInteractionHelper.formatTaskForAgent called.");
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
   * Detects if the agent's response contains unexecuted tool code
   * @param output The agent's output
   * @returns True if unexecuted tool code is detected, false otherwise
   */
  public detectUnexecutedToolCode(output: string): boolean {
    if (this.verbose)
      this.logVerbose(
        "AgentInteractionHelper.detectUnexecutedToolCode called."
      );
    const toolCodeRegex = /```(?:tool_code|python)[\s\S]*?```/g;
    const toolCodeMatches = output.match(toolCodeRegex);

    if (!toolCodeMatches) {
      return false;
    }

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
   * Helper method to check if an agent has tools available
   * @param agent The agent to check
   * @returns True if the agent has tools, false otherwise
   */
  public agentHasTools(agent: Agent): boolean {
    if (this.verbose)
      this.logVerbose("AgentInteractionHelper.agentHasTools called.");
    if (typeof agent.getTools === "function") {
      try {
        const tools = agent.getTools();
        return Array.isArray(tools) && tools.length > 0;
      } catch (_error) {
        return false;
      }
    }
    return false;
  }

  // Placeholder for _handleUnexecutedToolCode, which will need Agent and stream access
  // This might become part of TaskExecutor or require passing more context

  public async handleUnexecutedToolCode(
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
      this.logVerbose(
        // Use internal logVerbose
        `⚠️ Detected unexecuted tool code in ${agent.name}'s response. Requesting execution...`
      );
    }

    if (stream) {
      globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
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
        task.status = "failed";
        return `${agentResult.output}\n\n---\n\nTool Execution Issue:\n${factBasedErrorResult.output}`;
      }
      return `${agentResult.output}\n\n---\n\nExecution results:\n${executionResult.output}`;
    } catch (error) {
      if (this.verbose) {
        this.logVerbose(`❌ Error during tool code execution: ${error}`);
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
        task.status = "failed";
        return `${agentResult.output}\n\n---\n\nTool Execution Error: ${error}\n\n${errorResult.output}`;
      } catch (_errorHandlingError) {
        task.status = "failed";
        return `${agentResult.output}\n\n---\n\nTool Execution Error: ${error}\n\nUnable to execute tools. No data could be retrieved.`;
      }
    }
  }
}
