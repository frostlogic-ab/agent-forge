import type { AgentResult, Task } from "../../types";
import type { Agent } from "../agent";

export class TeamReporter {
  private verbose: boolean;
  private logVerbose: (message: string, icon?: string) => void;

  constructor(
    verbose: boolean,
    logVerbose: (message: string, icon?: string) => void
  ) {
    this.verbose = verbose;
    this.logVerbose = logVerbose;
  }

  // Methods for generating reports will be added here

  public generateProgressReport(
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

  public generateTaskChangeReport(changes: {
    modified: string[];
    canceled: string[];
  }): string {
    if (this.verbose)
      this.logVerbose("TeamReporter.generateTaskChangeReport called.");
    // This will contain the logic from the original generateTaskChangeReport method
    let report = "# Task Changes Applied\n\n";
    if (changes.canceled.length > 0) {
      report += `Canceled: ${changes.canceled.join(", ")}\n`;
    }
    if (changes.modified.length > 0) {
      report += `Modified: ${changes.modified.join(", ")}\n`;
    }
    report += "\nPlease review and proceed.";
    return report;
  }

  public async generateFinalResult(
    tasks: Map<string, Task>,
    conversationHistory: string[],
    manager: Agent // Parameter already exists
  ): Promise<AgentResult> {
    if (this.verbose) {
      this.logVerbose("\n🏁 All tasks completed. Generating final result...");
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

    const finalResult = await manager.run(finalPrompt);
    conversationHistory.push(`Manager (Final): ${finalResult.output}`);

    if (this.verbose) {
      this.logVerbose(
        `\n👨‍💼 Manager (Final Summary):\n${finalResult.output}\n`
      );
      this.logVerbose("\n✅ Team execution completed successfully\n");
    }

    return finalResult;
  }
}
