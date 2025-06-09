# Plugin System Example

This example demonstrates Agent Forge's powerful plugin architecture with lifecycle hooks. It shows how plugins can extend framework functionality and provide cross-cutting concerns like logging, metrics, security, and caching.

## Features Demonstrated

### Built-in Plugins
- **LoggingPlugin**: Provides detailed logging of agent and tool activities
- **MetricsPlugin**: Tracks performance metrics, token usage, and execution statistics

### Custom Plugins
- **SecurityPlugin**: Input validation and tool access control
- **CachingPlugin**: Agent result caching for improved performance

## Plugin Lifecycle Hooks

The example demonstrates these lifecycle hooks:

- `FRAMEWORK_INITIALIZE` - When the framework starts up
- `FRAMEWORK_READY` - When the framework is ready to use
- `AGENT_REGISTER` - When agents are registered
- `AGENT_BEFORE_RUN` - Before an agent executes
- `AGENT_AFTER_RUN` - After an agent completes
- `AGENT_ERROR` - When an agent encounters an error
- `TOOL_BEFORE_EXECUTE` - Before a tool runs
- `TOOL_AFTER_EXECUTE` - After a tool completes

## Running the Example

1. Set up your environment variables:
```bash
LLM_PROVIDER=openai  # or your preferred provider
LLM_API_KEY=your_api_key_here
LLM_API_MODEL=gpt-4  # or your preferred model
```

2. Run the example:
```bash
npm run example:plugins
```

## What You'll See

The example will:

1. **Initialize** the framework with plugins loaded
2. **Register agents** (with plugin hooks firing)
3. **Run individual agent tasks** showing:
   - Security validation of inputs
   - Caching behavior
   - Detailed logging
   - Metrics collection
4. **Run a team workflow** demonstrating plugins working with complex orchestration
5. **Display metrics** collected during execution
6. **Demonstrate plugin management** (enable/disable plugins)

## Example Output

```
🚀 Plugin Example Starting

📊 Plugin Status:
  ✅ logging v1.0.0 (Priority: 100)
  ✅ metrics v1.0.0 (Priority: 0)
  ✅ security v1.0.0 (Priority: 90)
  ✅ caching v1.0.0 (Priority: 50)

🔍 Running individual agent tasks...

[Plugin:logging] Agent ResearchAgent starting with input: What are the latest developments in quantum computing?...
[Plugin:security] ✅ Tool WebSearchTool security check passed
[Plugin:logging] Tool WebSearchTool executing with params: {"query":"latest developments quantum computing"}
[Plugin:logging] Tool WebSearchTool completed in 1250ms
[Plugin:logging] Agent ResearchAgent completed in 3420ms
[Plugin:caching] 💾 Cached result for agent ResearchAgent

📊 Plugin Metrics:
  🏃 Agent Runs: 3
  ⏱️  Total Execution Time: 8750ms
  ⚡ Average Execution Time: 2916.67ms
  🔧 Tool Calls: 2
  ❌ Errors: 0
  🎫 Total Tokens: 1247
    📝 Prompt Tokens: 892
    💬 Completion Tokens: 355
```

## Creating Custom Plugins

To create your own plugin, extend the `Plugin` class:

```typescript
import { Plugin, PluginLifecycleHooks, type PluginHookData } from 'agent-forge';

export class MyCustomPlugin extends Plugin {
  readonly name = 'my-plugin';
  readonly version = '1.0.0';
  readonly priority = 50; // Higher numbers run first

  getHooks() {
    return {
      [PluginLifecycleHooks.AGENT_BEFORE_RUN]: this.beforeAgentRun.bind(this),
      [PluginLifecycleHooks.AGENT_AFTER_RUN]: this.afterAgentRun.bind(this),
    };
  }

  private beforeAgentRun(data: PluginHookData): any {
    // Your pre-processing logic here
    this.log(`Agent ${data.payload.agent.name} is about to run`);
    return data.payload; // Can modify the payload
  }

  private afterAgentRun(data: PluginHookData): any {
    // Your post-processing logic here
    this.log(`Agent completed with output: ${data.payload.result.output}`);
    return data.payload;
  }
}
```

## Plugin Use Cases

This architecture enables many powerful use cases:

- **Development**: Debugging, performance profiling, step-through execution
- **Production**: Monitoring, alerting, health checks, SLA tracking
- **Security**: Input validation, output sanitization, access control
- **Performance**: Caching, connection pooling, request batching
- **Integration**: Database logging, webhook notifications, external APIs
- **Compliance**: Audit trails, data retention, privacy controls 