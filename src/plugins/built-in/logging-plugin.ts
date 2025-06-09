import {
  Plugin,
  type PluginHookData,
  PluginLifecycleHooks,
} from "../plugin-manager";

export class LoggingPlugin extends Plugin {
  readonly name = "logging";
  readonly version = "1.0.0";
  readonly priority = 100; // High priority to log early

  private startTimes: Map<string, number> = new Map();

  getHooks() {
    return {
      [PluginLifecycleHooks.FRAMEWORK_INITIALIZE]:
        this.logFrameworkEvent.bind(this),
      [PluginLifecycleHooks.FRAMEWORK_READY]: this.logFrameworkEvent.bind(this),
      [PluginLifecycleHooks.FRAMEWORK_SHUTDOWN]:
        this.logFrameworkEvent.bind(this),
      [PluginLifecycleHooks.AGENT_REGISTER]: this.logAgentRegister.bind(this),
      [PluginLifecycleHooks.AGENT_BEFORE_RUN]: this.logAgentStart.bind(this),
      [PluginLifecycleHooks.AGENT_AFTER_RUN]: this.logAgentComplete.bind(this),
      [PluginLifecycleHooks.AGENT_ERROR]: this.logAgentError.bind(this),
      [PluginLifecycleHooks.TOOL_BEFORE_EXECUTE]: this.logToolStart.bind(this),
      [PluginLifecycleHooks.TOOL_AFTER_EXECUTE]:
        this.logToolComplete.bind(this),
      [PluginLifecycleHooks.TOOL_ERROR]: this.logToolError.bind(this),
      [PluginLifecycleHooks.TEAM_BEFORE_RUN]: this.logTeamStart.bind(this),
      [PluginLifecycleHooks.TEAM_AFTER_RUN]: this.logTeamComplete.bind(this),
      [PluginLifecycleHooks.WORKFLOW_BEFORE_RUN]:
        this.logWorkflowStart.bind(this),
      [PluginLifecycleHooks.WORKFLOW_AFTER_RUN]:
        this.logWorkflowComplete.bind(this),
    };
  }

  private logFrameworkEvent(data: PluginHookData): any {
    const eventName = data.hook.split(":")[1];
    this.log(`🚀 Framework ${eventName}`);
    return data.payload;
  }

  private logAgentRegister(data: PluginHookData): any {
    const { agent, registered } = data.payload;
    if (registered) {
      this.log(`✅ Agent registered: ${agent.name}`);
    } else {
      this.log(`📝 Registering agent: ${agent.name}`);
    }
    return data.payload;
  }

  private logAgentStart(data: PluginHookData): any {
    const { agent, input } = data.payload;
    const startTime = Date.now();
    const agentKey = `agent:${agent.name}:${startTime}`;

    this.startTimes.set(agentKey, startTime);
    this.log(
      `🎯 Agent ${agent.name} starting with input: ${input.substring(0, 100)}${
        input.length > 100 ? "..." : ""
      }`
    );

    return { ...data.payload, _loggingKey: agentKey };
  }

  private logAgentComplete(data: PluginHookData): any {
    const { agent, result } = data.payload;
    const loggingKey = data.payload._loggingKey;

    let duration = "unknown";
    if (loggingKey && this.startTimes.has(loggingKey)) {
      const startTime = this.startTimes.get(loggingKey);
      if (startTime) {
        duration = `${Date.now() - startTime}ms`;
        this.startTimes.delete(loggingKey);
      }
    }

    this.log(
      `✅ Agent ${agent.name} completed in ${duration} - Output: ${result.output.substring(0, 150)}${
        result.output.length > 150 ? "..." : ""
      }`
    );

    return data.payload;
  }

  private logAgentError(data: PluginHookData): any {
    const { agent, error } = data.payload;
    this.log(
      `❌ Agent ${agent.name} error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error"
    );
    return data.payload;
  }

  private logToolStart(data: PluginHookData): any {
    const { toolName, parameters } = data.payload;
    const startTime = Date.now();
    const toolKey = `tool:${toolName}:${startTime}`;

    this.startTimes.set(toolKey, startTime);
    this.log(
      `🔧 Tool ${toolName} executing with params: ${JSON.stringify(parameters).substring(0, 200)}${
        JSON.stringify(parameters).length > 200 ? "..." : ""
      }`
    );

    return { ...data.payload, _loggingKey: toolKey };
  }

  private logToolComplete(data: PluginHookData): any {
    const { toolName, result } = data.payload;
    const loggingKey = data.payload._loggingKey;

    let duration = "unknown";
    if (loggingKey && this.startTimes.has(loggingKey)) {
      const startTime = this.startTimes.get(loggingKey);
      if (startTime) {
        duration = `${Date.now() - startTime}ms`;
        this.startTimes.delete(loggingKey);
      }
    }

    this.log(
      `✅ Tool ${toolName} completed in ${duration} - Result: ${JSON.stringify(result).substring(0, 150)}${
        JSON.stringify(result).length > 150 ? "..." : ""
      }`
    );

    return data.payload;
  }

  private logToolError(data: PluginHookData): any {
    const { toolName, error } = data.payload;
    this.log(
      `❌ Tool ${toolName} error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error"
    );
    return data.payload;
  }

  private logTeamStart(data: PluginHookData): any {
    const { team, input } = data.payload;
    this.log(
      `👥 Team ${team.getName()} starting with input: ${input.substring(0, 100)}${
        input.length > 100 ? "..." : ""
      }`
    );
    return data.payload;
  }

  private logTeamComplete(data: PluginHookData): any {
    const { team, result } = data.payload;
    this.log(
      `✅ Team ${team.getName()} completed - Output: ${result.output.substring(0, 150)}${
        result.output.length > 150 ? "..." : ""
      }`
    );
    return data.payload;
  }

  private logWorkflowStart(data: PluginHookData): any {
    const { workflow, input } = data.payload;
    this.log(
      `⚡ Workflow ${workflow.getName()} starting with input: ${input.substring(0, 100)}${
        input.length > 100 ? "..." : ""
      }`
    );
    return data.payload;
  }

  private logWorkflowComplete(data: PluginHookData): any {
    const { workflow, result } = data.payload;
    this.log(
      `✅ Workflow ${workflow.getName()} completed - Output: ${result.output.substring(0, 150)}${
        result.output.length > 150 ? "..." : ""
      }`
    );
    return data.payload;
  }

  async destroy(): Promise<void> {
    // Clear any remaining timing data
    this.startTimes.clear();
  }
}
