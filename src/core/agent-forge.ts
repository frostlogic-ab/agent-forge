import { loadAgentsFromDirectory } from "../config/yaml-loader";
import type { LLMProvider } from "../llm/llm-provider";
import type { Tool } from "../tools/tool";
import { ToolRegistry } from "../tools/tool-registry";
import {
  ExecutionMode,
  type TeamRunOptions,
  type WorkflowRunOptions,
} from "../types";
import { enableConsoleStreaming } from "../utils/streaming";
import type { Agent } from "./agent";
import { Team } from "./team";
import { Workflow } from "./workflow";

/**
 */
export class AgentForge {
  private agents: Map<string, Agent> = new Map();
  private tools: ToolRegistry = new ToolRegistry();
  private llmProvider?: LLMProvider;

  /**
   * Creates a new Agent Forge instance
   * @param llmProvider Optional default LLM provider for agents
   */
  constructor(llmProvider?: LLMProvider) {
    this.llmProvider = llmProvider;
  }

  /**
   * Sets the default LLM provider for agents
   * @param provider The LLM provider to use
   * @returns The AgentForge instance for method chaining
   */
  setDefaultLLMProvider(provider: LLMProvider): AgentForge {
    this.llmProvider = provider;

    // Update LLM provider for all registered agents
    if (this.llmProvider) {
      for (const agent of this.agents.values()) {
        agent.setLLMProvider(this.llmProvider);
      }
    }

    return this;
  }

  /**
   * Gets the default LLM provider
   */
  getDefaultLLMProvider(): LLMProvider | undefined {
    return this.llmProvider;
  }

  /**
   * Registers a tool with the framework
   * @param tool The tool to register
   * @returns The AgentForge instance for method chaining
   */
  registerTool(tool: Tool): AgentForge {
    this.tools.register(tool);
    return this;
  }

  /**
   * Registers multiple tools with the framework
   * @param tools The tools to register
   * @returns The AgentForge instance for method chaining
   */
  registerTools(tools: Tool[]): AgentForge {
    for (const tool of tools) {
      this.tools.register(tool);
    }
    return this;
  }

  /**
   * Gets all registered tools
   */
  getTools(): Tool[] {
    return this.tools.getAll();
  }

  /**
   * Registers an agent with the framework
   * @param agent The agent to register
   * @returns The AgentForge instance for method chaining
   */
  registerAgent(agent: Agent): AgentForge {
    // Apply the default LLM provider if set
    if (
      this.llmProvider &&
      !Object.prototype.hasOwnProperty.call(agent.getConfig(), "llmProvider")
    ) {
      agent.setLLMProvider(this.llmProvider);
    }

    this.agents.set(agent.name, agent);
    return this;
  }

  /**
   * Registers multiple agents with the framework
   * @param agents The agents to register
   * @returns The AgentForge instance for method chaining
   */
  registerAgents(agents: Agent[]): AgentForge {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
    return this;
  }

  /**
   * Gets all registered agents
   */
  getAgents(): Agent[] {
    return Array.from(this.agents.values());
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
   * Creates a new workflow
   * @param name Name of the workflow
   * @param description Description of the workflow
   * @returns A new workflow instance
   */
  createWorkflow(name?: string, description?: string): Workflow {
    return new Workflow(name, description);
  }

  /**
   * Creates a new team with a manager agent
   * @param managerName Name of the manager agent
   * @param name Name of the team
   * @param description Description of the team
   * @returns A new team instance
   */
  createTeam(managerName: string, name?: string, description?: string): Team {
    const manager = this.getAgent(managerName);
    if (!manager) {
      throw new Error(`Agent with name '${managerName}' is not registered`);
    }

    return new Team(manager, name, description);
  }

  /**
   * Loads agents from YAML files in a directory
   * @param directoryPath Path to directory containing agent YAML files
   * @returns The AgentForge instance for method chaining
   */
  async loadAgentsFromDirectory(directoryPath: string): Promise<AgentForge> {
    const agents = await loadAgentsFromDirectory(directoryPath);
    this.registerAgents(agents);
    return this;
  }

  /**
   * Runs a single agent by name
   * @param agentName Name of the agent to run
   * @param input Input for the agent
   * @returns The agent's result
   */
  async runAgent(agentName: string, input: string): Promise<any> {
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent with name '${agentName}' is not registered`);
    }

    return await agent.run(input);
  }

  /**
   * Runs a workflow with the given agents and input
   * @param agentNames Names of agents to include in the workflow
   * @param input Input to the workflow
   * @param options Optional settings for workflow execution
   * @returns The result of running the workflow
   */
  async runWorkflow(
    agentNames: string[],
    input: string,
    options?: WorkflowRunOptions
  ): Promise<any> {
    if (agentNames.length === 0) {
      throw new Error("No agents specified for workflow");
    }

    // If console streaming is enabled, initialize it
    if (options?.stream && options?.enableConsoleStream) {
      enableConsoleStreaming();
    }

    // Create a workflow with the specified agents
    const workflow = new Workflow(
      "Dynamic Workflow",
      "Dynamically created workflow"
    );

    for (const agentName of agentNames) {
      const agent = this.getAgent(agentName);
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found`);
      }
      workflow.addStep(agent);
    }

    // Run the workflow
    return await workflow.run(input, options);
  }

  /**
   * Runs a team with the given manager, agents, and input
   * @param managerName Name of the manager agent
   * @param agentNames Names of team member agents
   * @param input Input to the team
   * @param options Optional configuration for team execution
   * @returns The result of running the team
   */
  async runTeam(
    managerName: string,
    agentNames: string[],
    input: string,
    options?: TeamRunOptions
  ): Promise<any> {
    if (agentNames.length === 0) {
      throw new Error("No agents specified for team");
    }

    // If console streaming is enabled, initialize it
    if (options?.stream && options?.enableConsoleStream) {
      enableConsoleStreaming();
    }

    // Get the manager agent
    const manager = this.getAgent(managerName);
    if (!manager) {
      throw new Error(`Manager agent "${managerName}" not found`);
    }

    // Create a team with the manager
    const team = new Team(manager, "Dynamic Team", "Dynamically created team");

    // Add team members
    for (const agentName of agentNames) {
      if (agentName === managerName) continue; // Skip manager
      const agent = this.getAgent(agentName);
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found`);
      }
      team.addAgent(agent);
    }

    // Run the team
    return await team.run(input, options);
  }

  /**
   * Runs agents in the specified execution mode
   * @param mode Execution mode (sequential or hierarchical)
   * @param managerOrFirst Name of the manager (hierarchical) or first agent (sequential)
   * @param agentNames Names of agents to run
   * @param input Input to the agents
   * @param options Optional execution options
   * @returns The result of running the agents
   */
  async runWithMode(
    mode: ExecutionMode,
    managerOrFirst: string,
    agentNames: string[],
    input: string,
    options?: TeamRunOptions | WorkflowRunOptions
  ): Promise<any> {
    switch (mode) {
      case ExecutionMode.SEQUENTIAL:
        return this.runWorkflow(
          [managerOrFirst, ...agentNames],
          input,
          options as WorkflowRunOptions
        );
      case ExecutionMode.HIERARCHICAL:
        return this.runTeam(
          managerOrFirst,
          agentNames,
          input,
          options as TeamRunOptions
        );
      default:
        throw new Error(`Unsupported execution mode: ${mode}`);
    }
  }
}
