import type { Agent } from "../agent";

export interface AgentAssignment {
  agentName: string;
  task: string;
  // Potentially add title, why, dependsOn if parsed directly here
}

export class ManagerResponseParser {
  private agents: Map<string, Agent>;

  constructor(agents: Map<string, Agent>) {
    this.agents = agents;
  }

  public extractAgentAssignments(managerMessage: string): AgentAssignment[] {
    const assignments: AgentAssignment[] = [];
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

  public extractDependenciesFromDescription(description: string): string[] {
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
}
