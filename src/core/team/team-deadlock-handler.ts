import type { AgentResult, Task } from "../../types";
import type { Agent } from "../agent";

export class TeamDeadlockHandler {
  private manager: Agent;
  private verbose: boolean;
  private logVerbose: (message: string, icon?: string) => void;

  constructor(
    manager: Agent,
    logVerbose: (message: string, icon?: string) => void,
    verbose = false
  ) {
    this.manager = manager;
    this.logVerbose = logVerbose;
    this.verbose = verbose;
  }

  public async handlePotentialDeadlock(
    tasks: Map<string, Task>,
    conversationHistory: string[]
  ): Promise<AgentResult> {
    if (this.verbose) {
      this.logVerbose(
        "\n⚠️ Potential deadlock detected in workflow. Requesting manager guidance..."
      );
    }

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
1. Cancel tasks: Use "Cancel task: task-id" to cancel any pending task.
2. Modify dependencies: Use "Modify task: task-id depends on: task-X, task-Y" (or "none") to change dependencies.
3. Create new tasks: Assign new tasks to any available team member.
4. Proceed with the workflow: If you believe the workflow can continue, provide instructions for the next steps.
5. Provide a final response: If enough information is available, provide a final response to the original task using ONLY confirmed information from COMPLETED TASKS.
IMPORTANT: If you choose option 5, start your message with "FINAL RESPONSE:" and provide a complete answer to the original task using ONLY confirmed information from COMPLETED TASKS.
`;

    const deadlockResult = await this.manager.run(deadlockedPrompt);
    conversationHistory.push(
      `Manager (Deadlock Resolution): ${deadlockResult.output}`
    );
    if (this.verbose) {
      this.logVerbose(
        `\n👨‍💼 Manager (Deadlock Resolution):\n${deadlockResult.output}\n`
      );
    }
    return deadlockResult;
  }

  public detectRepeatedTaskFailurePattern(
    // Made public for now
    tasks: Map<string, Task>
  ): string | null {
    const failureCounts = new Map<string, number>();
    const lastFailureMessages = new Map<string, string>();
    let repeatedPatternDetected = false;

    for (const task of tasks.values()) {
      if (task.status === "failed" && task.result) {
        const normalizedMessage = task.result
          .replace(/task-\d+/g, "task-ID")
          .replace(/\d{2,}/g, "NUMBER")
          .substring(0, 150);
        const count = (failureCounts.get(normalizedMessage) || 0) + 1;
        failureCounts.set(normalizedMessage, count);
        lastFailureMessages.set(normalizedMessage, task.result);
        if (count >= 2) {
          repeatedPatternDetected = true;
        }
      }
    }

    if (repeatedPatternDetected) {
      let report = "DETECTED REPEATED TASK FAILURE PATTERN:\\n";
      report +=
        "Some tasks are repeatedly failing with similar errors. This might indicate a persistent issue.\\n";
      for (const [message, count] of failureCounts.entries()) {
        if (count >= 2) {
          report += `- Pattern (occurred ${count} times): \"${lastFailureMessages.get(message)?.substring(0, 100)}...\"\\n`;
        }
      }
      report +=
        "Consider if there's a systemic problem or if an agent is stuck.\\n";
      return report;
    }
    return null;
  }
}
