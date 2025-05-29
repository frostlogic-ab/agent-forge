import { loadAgentsFromDirectory } from "../config/yaml-loader";
import type { LLM } from "../llm/llm";
import { type Plugin, PluginLifecycleHooks, PluginManager } from "../plugins";
import type { Tool } from "../tools/tool";
import { ToolRegistry } from "../tools/tool-registry";
import {
  type AgentResult,
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
  private llmProvider?: LLM;
  private pluginManager: PluginManager;

  /**
   * Creates a new Agent Forge instance
   * @param llmProvider Optional default LLM provider for agents
   */
  constructor(llmProvider?: LLM) {
    this.llmProvider = llmProvider;
    this.pluginManager = new PluginManager(this);
  }

  /**
   * Gets the plugin manager
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /**
   * Registers a plugin with the framework
   * @param plugin The plugin to register
   * @returns The AgentForge instance for method chaining
   */
  async registerPlugin(plugin: Plugin): Promise<AgentForge> {
    await this.pluginManager.registerPlugin(plugin);
    return this;
  }

  /**
   * Initializes the framework and executes initialization hooks
   */
  async initialize(): Promise<void> {
    await this.pluginManager.executeHook(
      PluginLifecycleHooks.FRAMEWORK_INITIALIZE,
      { forge: this }
    );
    await this.pluginManager.executeHook(PluginLifecycleHooks.FRAMEWORK_READY, {
      forge: this,
    });
  }

  /**
   * Shuts down the framework and executes shutdown hooks
   */
  async shutdown(): Promise<void> {
    await this.pluginManager.executeHook(
      PluginLifecycleHooks.FRAMEWORK_SHUTDOWN,
      { forge: this }
    );
  }

  /**
   * Sets the default LLM provider for agents
   * @param provider The LLM provider to use
   * @returns The AgentForge instance for method chaining
   */
  setDefaultLLMProvider(provider: LLM): AgentForge {
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
  getDefaultLLMProvider(): LLM | undefined {
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
  async registerAgent(agent: Agent): Promise<AgentForge> {
    // Execute before hook
    const modifiedAgent = await this.pluginManager.executeHook(
      PluginLifecycleHooks.AGENT_REGISTER,
      { agent, registered: false }
    );

    const agentToRegister = modifiedAgent.agent || agent;

    // Apply the default LLM provider if set and agent doesn't have one
    if (this.llmProvider && !agentToRegister.getLLMProvider()) {
      agentToRegister.setLLMProvider(this.llmProvider);
    }

    this.agents.set(agentToRegister.name, agentToRegister);

    // Execute after hook
    await this.pluginManager.executeHook(PluginLifecycleHooks.AGENT_REGISTER, {
      agent: agentToRegister,
      registered: true,
    });

    return this;
  }

  /**
   * Registers multiple agents with the framework
   * @param agents The agents to register
   * @returns The AgentForge instance for method chaining
   */
  async registerAgents(agents: Agent[]): Promise<AgentForge> {
    for (const agent of agents) {
      await this.registerAgent(agent);
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

    // Set the visualizer flag on the Team class before creating the instance
    if ((this.constructor as any).__visualizerEnabled) {
      (Team as any).__visualizerEnabled = true;
    }

    const team = new Team(manager, name, description);
    return team;
  }

  /**
   * Loads agents from YAML files in a directory
   * @param directoryPath Path to directory containing agent YAML files
   * @returns The AgentForge instance for method chaining
   *
   * @deprecated Use the @agent decorator instead
   */
  async loadAgentsFromDirectory(directoryPath: string): Promise<AgentForge> {
    const agents = await loadAgentsFromDirectory(directoryPath);
    await this.registerAgents(agents);
    return this;
  }

  /**
   * Runs a single agent by name
   * @param agentName Name of the agent to run
   * @param input Input for the agent
   * @returns The agent's result
   */
  async runAgent(agentName: string, input: string): Promise<AgentResult> {
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent with name '${agentName}' is not registered`);
    }

    // Before run hook
    const beforeRunData = await this.pluginManager.executeHook(
      PluginLifecycleHooks.AGENT_BEFORE_RUN,
      { agent, input }
    );

    try {
      const result = await agent.run(beforeRunData.input || input);

      // After run hook
      const finalResult = await this.pluginManager.executeHook(
        PluginLifecycleHooks.AGENT_AFTER_RUN,
        { agent, input, result }
      );

      return finalResult.result || result;
    } catch (error) {
      // Error hook
      await this.pluginManager.executeHook(PluginLifecycleHooks.AGENT_ERROR, {
        agent,
        input,
        error,
      });
      throw error;
    }
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
  ): Promise<AgentResult> {
    if (agentNames.length === 0) {
      throw new Error("No agents specified for workflow");
    }

    if (options?.stream && options?.enableConsoleStream) {
      enableConsoleStreaming();
    }

    const workflow = new Workflow(
      "Dynamic Workflow",
      "Dynamically created workflow"
    );
    const forgeTools = this.tools.getAll(); // Get tools from AgentForge

    for (const agentName of agentNames) {
      const agent = this.getAgent(agentName);
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found`);
      }
      // Add tools from the forge to the agent
      // Agent.addTool should handle duplicates gracefully (e.g., by name)
      for (const tool of forgeTools) {
        agent.addTool(tool);
      }
      workflow.addStep(agent);
    }

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
  ): Promise<AgentResult> {
    if (agentNames.length === 0) {
      throw new Error("No agents specified for team");
    }

    if (options?.stream && options?.enableConsoleStream) {
      enableConsoleStreaming();
    }

    const manager = this.getAgent(managerName);
    if (!manager) {
      throw new Error(`Manager agent "${managerName}" not found`);
    }
    const forgeTools = this.tools.getAll(); // Get tools from AgentForge

    // Add tools from the forge to the manager
    // Agent.addTool should handle duplicates gracefully
    for (const tool of forgeTools) {
      manager.addTool(tool);
    }

    const team = new Team(manager, "Dynamic Team", "Dynamically created team");

    for (const agentName of agentNames) {
      if (agentName === managerName) continue;
      const agent = this.getAgent(agentName);
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found`);
      }
      // Add tools from the forge to the agent
      // Agent.addTool should handle duplicates gracefully
      for (const tool of forgeTools) {
        agent.addTool(tool);
      }
      team.addAgent(agent);
    }

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
  ): Promise<AgentResult> {
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

/**
 * Utility to instantiate a decorated team/forge class and await its async static initialization.
 * This function handles all the async setup needed for agents and forge initialization.
 * @param TeamClass The class to instantiate
 * @param agents Optional array of agents to register and configure with LLM provider
 * @returns The instance, after static async initialization is complete
 */
export async function readyForge<T extends { new (...args: any[]): any }>(
  TeamClass: T,
  agents?: Agent[],
  ...args: ConstructorParameters<T>
): Promise<InstanceType<T>> {
  const instance = new TeamClass(...args);

  // Wait for static forge initialization (old forgeReady pattern)
  if ((TeamClass as any).forgeReady) {
    await (TeamClass as any).forgeReady;
  }

  // Wait for LLM provider initialization (new decorator pattern)
  if ((instance.constructor as any).forgeReady) {
    await (instance.constructor as any).forgeReady;
  }

  // If agents are provided, configure them with the LLM provider
  if (agents && agents.length > 0) {
    const forge = (instance.constructor as any).forge as AgentForge;
    if (forge) {
      const llmProvider = forge.getDefaultLLMProvider();
      if (llmProvider) {
        agents.forEach((agent) => {
          agent.setLLMProvider(llmProvider);
        });
      }
      await forge.registerAgents(agents);
    }
  }

  return instance as InstanceType<T>;
}
