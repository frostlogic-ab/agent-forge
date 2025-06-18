export class AgentForgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentForgeError';
  }
}

export class LLMConnectionError extends AgentForgeError {
  constructor(message: string, public readonly provider: string, public readonly endpoint?: string) {
    super(message);
    this.name = 'LLMConnectionError';
  }
}

export class ToolExecutionError extends AgentForgeError {
  constructor(message: string, public readonly toolName: string, public readonly toolArgs: Record<string, any>) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export class AgentConfigurationError extends AgentForgeError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigurationError';
  }
}

export class PluginError extends AgentForgeError {
  constructor(message: string, public readonly pluginName: string) {
    super(message);
    this.name = 'PluginError';
  }
}




export class ToolConfigurationError extends AgentForgeError {
  constructor(message: string) {
    super(message);
    this.name = 'ToolConfigurationError';
  }
}


