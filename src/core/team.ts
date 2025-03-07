import type { AgentResult } from "../types";
import type { Agent } from "./agent";

/**
 * Represents a team of agents with a manager
 */
export class Team {
  private manager: Agent;
  private agents: Map<string, Agent> = new Map();
  private name: string;
  private description: string;

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
   * @returns The final result
   */
  async run(input: string): Promise<AgentResult> {
    // Reset all agent conversations
    this.reset();

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

    // Run the manager agent to orchestrate the team
    return await this.runTeamWithManager(managerPrompt);
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

    // Parse the manager's output to identify subtasks and assigned agents
    // This is a simplified implementation - in a real scenario, you'd implement
    // more sophisticated parsing and coordination logic

    // For this simplified version, we'll let the manager handle the entire process
    // through multiple conversation turns with the team members

    // We'll simulate a few exchanges between the manager and team members
    const MAX_ITERATIONS = 5;
    let currentInput = managerResult.output;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Extract potential agent assignments from the manager's message
      const assignments = this.extractAgentAssignments(currentInput);

      if (assignments.length === 0) {
        // No more assignments, we're done
        break;
      }

      // Process each assignment
      for (const assignment of assignments) {
        const { agentName, task } = assignment;
        const agent = this.agents.get(agentName);

        if (agent) {
          // Get the agent's response
          const agentResult = await agent.run(task);

          // Add to conversation history
          conversationHistory.push(`${agentName}: ${agentResult.output}`);

          // Update the current input for the manager
          currentInput += `\n\n${agentName}'s response: ${agentResult.output}`;
        }
      }

      // Get the manager's next instructions
      const nextManagerResult = await this.manager.run(currentInput);

      // Add to conversation history
      conversationHistory.push(`Manager: ${nextManagerResult.output}`);

      // Update the current input
      currentInput = nextManagerResult.output;
    }

    // Get the final synthesis from the manager
    const finalPrompt = `
Based on all the work and responses from the team, please provide a final comprehensive response to the original task.
The conversation history is:

${conversationHistory.join("\n\n")}
`;

    return await this.manager.run(finalPrompt);
  }

  /**
   * Extracts agent assignments from a manager message
   * This is a simplified implementation - in a real scenario, you would use
   * more sophisticated parsing or structured data exchange between agents
   * @param managerMessage The message from the manager
   * @returns Array of agent assignments
   */
  private extractAgentAssignments(
    managerMessage: string
  ): Array<{ agentName: string; task: string }> {
    const assignments: Array<{ agentName: string; task: string }> = [];

    // Get all agent names
    const agentNames = Array.from(this.agents.keys());

    // Simple regex-based parsing to find assignments
    // Looking for patterns like "AgentName: task description" or "Assign AgentName to: task description"
    for (const agentName of agentNames) {
      const patterns = [
        new RegExp(`${agentName}:\\s*([^\\n]+)`, "i"),
        new RegExp(`assign\\s+${agentName}\\s+to:\\s*([^\\n]+)`, "i"),
        new RegExp(`${agentName}\\s+should\\s+([^\\n]+)`, "i"),
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
