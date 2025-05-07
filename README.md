# Agent Forge 🔨

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Agent Forge is a TypeScript framework for creating, configuring, and orchestrating AI agents that connect to LLMs (Large Language Models). It allows developers to define agents through YAML configuration files and enables both sequential and hierarchical execution patterns.

## 📋 Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Create Agent Forge Instance](#1-create-agent-forge-instance)
  - [Define Agent in YAML](#2-define-your-agent-in-a-yaml-file)
  - [Run Single Agent](#3-create-and-run-your-agent)
  - [Create Sequential Workflow](#4-create-a-workflow-of-sequential-agents)
  - [Create Agent Team](#5-create-a-hierarchical-team-with-a-manager-agent)
  - [Use Rate Limiting](#6-use-rate-limiting-to-avoid-api-quota-issues)
  - [Debug Interactions](#7-debug-team-interactions-with-verbose-logging)
  - [Stream Communications](#8-stream-agent-communications-in-real-time)
  - [Use Model Context Protocol](#9-use-model-context-protocol-mcp-to-extend-agent-capabilities)
- [Development](#development)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## ✨ Features

- 📝 **YAML-Defined Agents**: Configure agents with role, description, and objectives through simple YAML files
- 🧰 **Tool Ecosystem**: Extend agents with custom tools to interact with external systems
- 🔄 **Flexible Execution Patterns**:
  - Sequential execution (workflow-based)
  - Hierarchical execution (manager AI delegates to specialized agents)
- 🔌 **LLM Integration**: Connect to various language models through a unified interface
- 🚦 **Rate Limiting**: Control API usage with built-in rate limiting to avoid quota issues
- 📡 **Streaming Support**:
  - Stream agent communications in real-time
  - Console streaming for immediate visibility of agent outputs
- 🔍 **Debugging Features**:
  - Verbose logging of agent interactions with detailed execution flow
  - Real-time visibility into task assignments and dependencies
  - Comprehensive progress tracking and error reporting
  - Visual indicators for task status and execution timing
- 🔗 **Model Context Protocol (MCP)**: Connect to external tool servers using standardized protocols
- 📊 **TypeScript Support**: Built with TypeScript for type safety and better developer experience

---

## 📦 Installation

Choose your preferred package manager:

```bash
# npm
npm install agent-forge

# yarn
yarn add agent-forge

# pnpm
pnpm add agent-forge
```

---

## 🚀 Quick Start

### 1. Create Agent Forge instance

```typescript
// Create an LLM provider
// You can use one of the available TokenJS providers from here:
// https://github.com/token-js/token.js/tree/main?tab=readme-ov-file#supported-providers

const llmProvider = new LLM("openai", {
  apiKey,
});

// Create the AgentForge instance
const forge = new AgentForge(llmProvider);
```

### 2. Define your agent in a YAML file

```yaml
# agent.yaml
name: ResearchAgent
role: Research Assistant
description: An agent that helps with online research
objective: Find accurate and relevant information based on user queries
model: gpt-4
temperature: 0.7
tools:
  - name: WebSearch
    description: Search the web for information
```

### 3. Create and run your agent

```typescript
import { AgentForge, loadAgentFromYaml } from "agent-forge";

// Load agent from YAML
const agent = await loadAgentFromYaml("./agent.yaml");

// Run the agent
const result = await agent.run("What are the latest developments in AI?");
console.log(result);
```

### 4. Create a workflow of sequential agents

```typescript
import { Workflow, loadAgentFromYaml } from "agent-forge";

// Load multiple agents
const researchAgent = await loadAgentFromYaml("./research-agent.yaml");
const summaryAgent = await loadAgentFromYaml("./summary-agent.yaml");

// Create a workflow
const workflow = new Workflow().addStep(researchAgent).addStep(summaryAgent);

// Run the workflow
const result = await workflow.run(
  "Explain quantum computing advancements in 2023"
);
console.log(result);
```

### 5. Create a hierarchical team with a manager agent

```typescript
import { Team, loadAgentFromYaml } from "agent-forge";

// Load manager and specialized agents
const managerAgent = await loadAgentFromYaml("./manager-agent.yaml");
const codeAgent = await loadAgentFromYaml("./code-agent.yaml");
const designAgent = await loadAgentFromYaml("./design-agent.yaml");

// Create a team with a manager
const team = new Team(managerAgent).addAgent(codeAgent).addAgent(designAgent);

// Run the team
const result = await team.run("Create a landing page for our new product");
console.log(result);
```

### 6. Use rate limiting to avoid API quota issues

```typescript
import { Team, loadAgentFromYaml } from "agent-forge";

// Load manager and specialized agents
const managerAgent = await loadAgentFromYaml("./manager-agent.yaml");
const researchAgent = await loadAgentFromYaml("./research-agent.yaml");
const summaryAgent = await loadAgentFromYaml("./summary-agent.yaml");

// Create a team with a manager
const team = new Team(managerAgent)
  .addAgent(researchAgent)
  .addAgent(summaryAgent);

// Run the team with rate limiting (max 20 LLM calls per minute)
const result = await team.run(
  "What is quantum computing and how might it affect cybersecurity?",
  { rate_limit: 20 }
);
console.log(result);
```

### 7. Debug team interactions with verbose logging

```typescript
import { Team, loadAgentFromYaml } from "agent-forge";

// Load manager and specialized agents
const managerAgent = await loadAgentFromYaml("./manager-agent.yaml");
const researchAgent = await loadAgentFromYaml("./research-agent.yaml");
const summaryAgent = await loadAgentFromYaml("./summary-agent.yaml");

// Create a team with a manager
const team = new Team(managerAgent)
  .addAgent(researchAgent)
  .addAgent(summaryAgent);

// Run the team with verbose logging
const result = await team.run(
  "What are the ethical implications of AI in healthcare?",
  { verbose: true }
);
console.log("Final result:", result.output);
```

#### Verbose Output Example

When verbose logging is enabled, you'll see detailed information about:

```
🚀 Starting team execution with 2 agents and 1 manager
📋 Task: "What are the ethical implications of AI in healthcare?"

👨‍💼 Manager (Initial Plan):
Assigning tasks to team members...

🔄 System: Created task task-0 for Researcher: Research current AI applications in healthcare
📌 Dependencies: none

⏳ Starting task task-0 for agent "Researcher"...
👤 Researcher (Task task-0):
[Research findings...]
✅ Task task-0 completed in 2.34s

📊 Progress Report:
Completed Tasks:
- Task task-0 (Researcher): [Research results...]

👨‍💼 Manager:
[Next instructions...]

🏁 All tasks completed. Generating final result...
✅ Team execution completed successfully
```

You can also combine options:

```typescript
// Run with both rate limiting and verbose logging
const result = await team.run(
  "Explain the impact of blockchain on financial systems",
  {
    rate_limit: 15, // Limit to 15 LLM calls per minute
    verbose: true, // Enable detailed logging
  }
);
```

### 8. Stream agent communications in real-time

```typescript
import { Workflow, loadAgentFromYaml } from "agent-forge";
import { AgentForgeEvents, globalEventEmitter } from "agent-forge";

// Load multiple agents
const researchAgent = await loadAgentFromYaml("./research-agent.yaml");
const summaryAgent = await loadAgentFromYaml("./summary-agent.yaml");

// Set up event listeners for streaming
globalEventEmitter.on(AgentForgeEvents.AGENT_THINKING, (data) => {
  console.log(`Agent ${data.name} thinking: ${data.thought}`);
});

globalEventEmitter.on(AgentForgeEvents.AGENT_RESPONSE, (data) => {
  console.log(`Agent ${data.name} responded: ${data.response}`);
});

globalEventEmitter.on(AgentForgeEvents.EXECUTION_COMPLETE, (data) => {
  console.log(`Execution complete for ${data.type} "${data.name}"`);
});

// Create a workflow with streaming enabled
const workflow = new Workflow().addStep(researchAgent).addStep(summaryAgent);

// Run the workflow with streaming enabled
const result = await workflow.run(
  "Explain quantum computing advancements in 2023",
  { stream: true }
);
```

For console streaming, you can also use:

```typescript
const result = await workflow.run(
  "Explain quantum computing advancements in 2023",
  {
    stream: true,
    enableConsoleStream: true,
  }
);
```

#### Streaming Benefits

With streaming enabled, you'll receive real-time updates about:

- Agent thinking processes
- Agent responses
- Execution completion events

This is particularly useful for:

- Building reactive UIs that show progress to users
- Debugging complex agent interactions
- Creating logging systems for agent behavior
- Providing immediate feedback during long-running tasks

You can combine streaming with other options:

```typescript
// Run with streaming, rate limiting, and verbose logging
const result = await workflow.run(
  "Explain the impact of blockchain on financial systems",
  {
    stream: true, // Enable streaming of agent communications
    enableConsoleStream: true, // Enable console streaming for visibility
    rate_limit: 15, // Limit to 15 LLM calls per minute
    verbose: true, // Enable detailed logging
  }
);
```

### 9. Use Model Context Protocol (MCP) to extend agent capabilities

Agent Forge supports the Model Context Protocol (MCP), which allows agents to connect to external tool servers and use their capabilities.

```typescript
import {
  Agent,
  LLM,
  MCPManager,
  createMCPConnection,
  MCPProtocolType,
} from "agent-forge";

// Create an LLM provider
const llmProvider = new LLM("openai", {
  apiKey: process.env.OPENAI_API_KEY,
});

// Create an MCP manager
const mcpManager = new MCPManager();

// Connect to a local MCP server using STDIO
const stdioConnection = createMCPConnection(MCPProtocolType.STDIO, {
  command: "python",
  args: ["./path/to/mcp_server.py"],
  env: { API_KEY: "your-api-key" },
});
await mcpManager.addConnection(stdioConnection);

// Connect to a remote MCP server using SSE
const sseConnection = createMCPConnection(MCPProtocolType.SSE, {
  url: "https://your-mcp-server.example.com/sse",
  headers: { Authorization: "Bearer your-token" },
});
await mcpManager.addConnection(sseConnection);

// Get all tools from the MCP servers
const mcpTools = mcpManager.getTools();

// Create an agent with MCP tools
const agent = new Agent({
  name: "MCP-Enabled Agent",
  role: "Assistant with extended capabilities",
  model: "gpt-4-turbo",
  temperature: 0.7,
  tools: mcpTools, // Use MCP tools
});

// Run the agent
const result = await agent.run(
  "Analyze this data using the specialized tools."
);
console.log(result);

// Always close connections when done
await mcpManager.close();
```

With MCP support, your agents can:

- Connect to specialized tool servers
- Access hundreds of third-party services
- Extend capabilities without modifying the agent framework
- Standardize tool interactions across different providers

You can run the MCP example with:

```bash
yarn example:mcp
```

---

## 🛠️ Development

### Code Linting and Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting TypeScript code. Biome is a fast, modern tool that replaces ESLint, Prettier, and more in a single package.

To lint the codebase:

```bash
yarn lint
```

To automatically fix issues:

```bash
yarn lint:fix       # Apply safe fixes only
yarn lint:fix:all   # Apply all fixes including unsafe ones
```

To format code:

```bash
yarn format
```

If you're using VS Code, install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) to get real-time linting and formatting.

---

## 📖 Documentation

For complete documentation, please visit [our documentation site](https://agent-forge.dev/docs) (coming soon).

---

## 👥 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## 📄 License

MIT
