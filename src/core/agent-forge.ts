import {
  loadAgentFromYaml,
  loadAgentsFromDirectory,
} from "../config/yaml-loader";
import type { LLMProvider } from "../llm/llm-provider";
import type { Tool } from "../tools/tool";
import { ToolRegistry } from "../tools/tool-registry";
import { ExecutionMode } from "../types";
import type { Agent } from "./agent";
import { Team } from "./team";
import type { TeamRunOptions } from "./team";
import { Workflow } from "./workflow";

/**
 * Main class for the Agent Forge framework
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
   * Creates and runs a workflow with the specified agents
   * @param agentNames Names of agents to include in the workflow
   * @param input Input for the workflow
   * @returns The workflow's result
   */
  async runWorkflow(agentNames: string[], input: string): Promise<any> {
    const workflow = this.createWorkflow();

    for (const name of agentNames) {
      const agent = this.getAgent(name);
      if (!agent) {
        throw new Error(`Agent with name '${name}' is not registered`);
      }

      workflow.addStep(agent);
    }

    return await workflow.run(input);
  }

  /**
   * Creates and runs a team with the specified manager and agents
   * @param managerName Name of the manager agent
   * @param agentNames Names of team member agents
   * @param input Input for the team
   * @param options Optional configuration for team execution
   * @returns The team's result
   */
  async runTeam(
    managerName: string,
    agentNames: string[],
    input: string,
    options?: TeamRunOptions
  ): Promise<any> {
    const team = this.createTeam(managerName);

    for (const name of agentNames) {
      const agent = this.getAgent(name);
      if (!agent) {
        throw new Error(`Agent with name '${name}' is not registered`);
      }

      team.addAgent(agent);
    }

    return await team.run(input, options);
  }

  /**
   * Runs agents in the specified execution mode
   * @param mode Execution mode (sequential or hierarchical)
   * @param managerOrFirst Name of the manager (hierarchical) or first agent (sequential)
   * @param agentNames Names of other agents to include
   * @param input Input for the execution
   * @param options Optional configuration for team execution (only used in hierarchical mode)
   * @returns The execution result
   */
  async runWithMode(
    mode: ExecutionMode,
    managerOrFirst: string,
    agentNames: string[],
    input: string,
    options?: TeamRunOptions
  ): Promise<any> {
    if (mode === ExecutionMode.SEQUENTIAL) {
      return await this.runWorkflow([managerOrFirst, ...agentNames], input);
    }
    return await this.runTeam(managerOrFirst, agentNames, input, options);
  }
}
