import type { AgentResult } from "../types";
import type { Agent } from "./agent";

/**
 * Represents a step in a workflow
 */
interface WorkflowStep {
  agent: Agent;
  inputTransform?: (input: string, previousResults: AgentResult[]) => string;
}

/**
 * Workflow for sequential execution of agents
 */
export class Workflow {
  private steps: WorkflowStep[] = [];
  private name: string;
  private description: string;

  /**
   * Creates a new workflow
   * @param name Name of the workflow
   * @param description Description of the workflow
   */
  constructor(name = "Workflow", description = "A sequence of agents") {
    this.name = name;
    this.description = description;
  }

  /**
   * Sets the name of the workflow
   * @param name The new name
   * @returns The workflow instance for method chaining
   */
  setName(name: string): Workflow {
    this.name = name;
    return this;
  }

  /**
   * Sets the description of the workflow
   * @param description The new description
   * @returns The workflow instance for method chaining
   */
  setDescription(description: string): Workflow {
    this.description = description;
    return this;
  }

  /**
   * Gets the name of the workflow
   */
  getName(): string {
    return this.name;
  }

  /**
   * Gets the description of the workflow
   */
  getDescription(): string {
    return this.description;
  }

  /**
   * Adds a step to the workflow
   * @param agent The agent to execute in this step
   * @param inputTransform Optional function to transform the input for this step
   * @returns The workflow instance for method chaining
   */
  addStep(
    agent: Agent,
    inputTransform?: (input: string, previousResults: AgentResult[]) => string
  ): Workflow {
    this.steps.push({
      agent,
      inputTransform,
    });
    return this;
  }

  /**
   * Gets all steps in the workflow
   * @returns Array of workflow steps
   */
  getSteps(): WorkflowStep[] {
    return [...this.steps];
  }

  /**
   * Runs the workflow with the given input
   * @param input The initial input to the workflow
   * @returns The result of the last agent in the workflow
   */
  async run(input: string): Promise<AgentResult> {
    if (this.steps.length === 0) {
      throw new Error("Workflow has no steps");
    }

    let currentInput = input;
    const results: AgentResult[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      // Transform the input if a transform function is provided
      if (step.inputTransform && i > 0) {
        currentInput = step.inputTransform(currentInput, results);
      }

      // Execute the agent
      const result = await step.agent.run(currentInput);

      // Store the result
      results.push(result);

      // Use the output as input for the next step
      currentInput = result.output;
    }

    // Return the result of the last step
    return results[results.length - 1];
  }

  /**
   * Resets all agents in the workflow
   */
  reset(): void {
    for (const step of this.steps) {
      step.agent.resetConversation();
    }
  }
}
