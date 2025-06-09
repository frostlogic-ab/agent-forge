import type { AgentForge } from "../core/agent-forge";

export enum PluginLifecycleHooks {
  // Framework lifecycle
  FRAMEWORK_INITIALIZE = "framework:initialize",
  FRAMEWORK_READY = "framework:ready",
  FRAMEWORK_SHUTDOWN = "framework:shutdown",

  // Agent lifecycle
  AGENT_REGISTER = "agent:register",
  AGENT_BEFORE_RUN = "agent:before_run",
  AGENT_AFTER_RUN = "agent:after_run",
  AGENT_ERROR = "agent:error",

  // LLM lifecycle
  LLM_BEFORE_REQUEST = "llm:before_request",
  LLM_AFTER_REQUEST = "llm:after_request",
  LLM_STREAM_START = "llm:stream_start",
  LLM_STREAM_END = "llm:stream_end",

  // Tool lifecycle
  TOOL_BEFORE_EXECUTE = "tool:before_execute",
  TOOL_AFTER_EXECUTE = "tool:after_execute",
  TOOL_ERROR = "tool:error",

  // Team/Workflow lifecycle
  TEAM_BEFORE_RUN = "team:before_run",
  TEAM_AFTER_RUN = "team:after_run",
  WORKFLOW_BEFORE_RUN = "workflow:before_run",
  WORKFLOW_AFTER_RUN = "workflow:after_run",
}

export interface PluginContext {
  forge: AgentForge;
  [key: string]: any;
}

export interface PluginHookData {
  hook: PluginLifecycleHooks;
  payload: any;
  context?: PluginContext;
}

export type PluginHookHandler = (data: PluginHookData) => any;

export abstract class Plugin {
  abstract readonly name: string;
  abstract readonly version: string;
  readonly priority: number = 0; // Higher numbers run first
  enabled = true;

  /**
   * Get the hooks this plugin wants to register
   */
  abstract getHooks(): Partial<Record<PluginLifecycleHooks, PluginHookHandler>>;

  /**
   * Initialize the plugin (called after registration)
   */
  async initialize(_context: PluginContext): Promise<void> {
    // Default implementation - override if needed
  }

  /**
   * Cleanup plugin resources (called during shutdown)
   */
  async destroy(): Promise<void> {
    // Default implementation - override if needed
  }

  /**
   * Enable this plugin
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable this plugin
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Log a message with plugin context
   */
  protected log(
    message: string,
    level: "info" | "warn" | "error" = "info"
  ): void {
    const prefix = `[Plugin:${this.name}]`;
    switch (level) {
      case "warn":
        console.warn(prefix, message);
        break;
      case "error":
        console.error(prefix, message);
        break;
      default:
        console.log(prefix, message);
        break;
    }
  }
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private hooks: Map<
    PluginLifecycleHooks,
    Array<{ plugin: Plugin; handler: PluginHookHandler }>
  > = new Map();
  private context: PluginContext;

  constructor(forge: AgentForge) {
    this.context = { forge };
  }

  /**
   * Register a plugin
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(
        `Plugin with name '${plugin.name}' is already registered`
      );
    }

    this.plugins.set(plugin.name, plugin);

    // Register hooks
    const pluginHooks = plugin.getHooks();
    for (const [hookName, handler] of Object.entries(pluginHooks)) {
      if (!handler) continue;

      const hook = hookName as PluginLifecycleHooks;
      if (!this.hooks.has(hook)) {
        this.hooks.set(hook, []);
      }

      const handlers = this.hooks.get(hook);
      if (handlers) {
        handlers.push({ plugin, handler });
      }
    }

    // Sort hooks by plugin priority (higher priority first)
    for (const handlers of this.hooks.values()) {
      handlers.sort((a, b) => b.plugin.priority - a.plugin.priority);
    }

    // Initialize plugin
    await plugin.initialize(this.context);
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return;
    }

    // Remove from hooks
    for (const handlers of this.hooks.values()) {
      const index = handlers.findIndex((h) => h.plugin === plugin);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }

    // Cleanup plugin
    await plugin.destroy();

    this.plugins.delete(pluginName);
  }

  /**
   * Execute hooks for a lifecycle event
   */
  async executeHook<T = any>(
    hook: PluginLifecycleHooks,
    payload: any
  ): Promise<T> {
    const handlers = this.hooks.get(hook);
    if (!handlers || handlers.length === 0) {
      return payload;
    }

    let currentPayload = payload;

    for (const { plugin, handler } of handlers) {
      if (!plugin.enabled) {
        continue;
      }

      try {
        const hookData: PluginHookData = {
          hook,
          payload: currentPayload,
          context: this.context,
        };

        const result = await handler(hookData);
        if (result !== undefined) {
          currentPayload = result;
        }
      } catch (error) {
        console.error(
          `Error in plugin '${plugin.name}' for hook '${hook}':`,
          error
        );
        // Continue with other plugins
      }
    }

    return currentPayload;
  }

  /**
   * Get a specific plugin by name
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all enabled plugins
   */
  getEnabledPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.enabled);
  }

  /**
   * Get all disabled plugins
   */
  getDisabledPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => !p.enabled);
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get plugin count
   */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    const plugins = Array.from(this.plugins.values());

    for (const plugin of plugins) {
      try {
        await plugin.destroy();
      } catch (error) {
        console.error(`Error shutting down plugin '${plugin.name}':`, error);
      }
    }

    this.plugins.clear();
    this.hooks.clear();
  }
}
