# Agent Forge

Agent Forge is a TypeScript framework for creating, configuring, and orchestrating AI agents that connect to LLMs (Large Language Models). It allows developers to define agents through YAML configuration files and enables both sequential and hierarchical execution patterns.

## Features

- **YAML-Defined Agents**: Configure agents with role, description, and objectives through simple YAML files
- **Tool Ecosystem**: Extend agents with custom tools to interact with external systems
- **Flexible Execution Patterns**:
  - Sequential execution (workflow-based)
  - Hierarchical execution (manager AI delegates to specialized agents)
- **LLM Integration**: Connect to various language models through a unified interface
- **Rate Limiting**: Control API usage with built-in rate limiting to avoid quota issues
- **TypeScript Support**: Built with TypeScript for type safety and better developer experience

## Installation

```bash
npm install agent-forge
```

## Quick Start

### 1. Define your agent in a YAML file:

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

### 2. Create and run your agent:

```typescript
import { AgentForge, loadAgentFromYaml } from "agent-forge";

// Load agent from YAML
const agent = await loadAgentFromYaml("./agent.yaml");

// Run the agent
const result = await agent.run("What are the latest developments in AI?");
console.log(result);
```

### 3. Create a workflow of sequential agents:

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

### 4. Create a hierarchical team with a manager agent:

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

### 5. Use rate limiting to avoid API quota issues:

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

## Development

### Code Linting and Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting TypeScript code. Biome is a fast, modern tool that replaces ESLint, Prettier, and more in a single package.

To lint the codebase:

```bash
npm run lint
```

To automatically fix issues:

```bash
npm run lint:fix       # Apply safe fixes only
npm run lint:fix:all   # Apply all fixes including unsafe ones
```

To format code:

```bash
npm run format
```

If you're using VS Code, install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) to get real-time linting and formatting.

## Documentation

For complete documentation, please visit [our documentation site](https://agent-forge.dev/docs) (coming soon).

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

MIT
