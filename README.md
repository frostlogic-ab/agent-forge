# Agent Forge 🔨

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/Documentation-blue?style=for-the-badge&logo=read-the-docs&logoColor=white)](https://frostlogic-ab.github.io/agent-forge/)

Agent Forge is a TypeScript framework for building, orchestrating, and running advanced AI agents and agent teams. It supports LLMs, tool use, hierarchical teams, remote agent protocols (A2A), and MCP tool integration. Designed for extensibility, composability, and real-world AI agent applications.

## Features

- **Decorator-based agent definition**: Use TypeScript decorators for agent config, LLM provider, tool integration, and remote protocols.
- **Tool ecosystem**: Add built-in, custom, or MCP tools to agents.
- **Teams**: Create hierarchical teams with a manager agent that delegates tasks.
- **Remote agents (A2A)**: Expose agents as remote services or connect to remote agents.
- **Streaming**: Real-time streaming of LLM and agent outputs.
- **TypeScript-first**: Full type safety and modern developer experience.

## Installation

```bash
yarn add agent-forge
# or
npm install agent-forge
```

**Prerequisites:**

- Node.js (latest LTS recommended)
- LLM API keys (e.g., OpenAI)
- (For MCP/Brave Search) Docker and relevant API keys

## Quick Start

### 1. Team of Local Agents

```ts
import { forge, llmProvider, agent } from "agent-forge";
import { AgentForge, Agent } from "agent-forge";

@agent({
  name: "ManagerAgent",
  role: "Manager",
  description: "Delegates tasks to team members.",
  objective: "Coordinate the team to solve complex tasks.",
  model: process.env.LLM_API_MODEL!,
})
class ManagerAgent extends Agent {}

@agent({
  name: "ResearcherAgent",
  role: "Research Specialist",
  description: "Finds and analyzes information.",
  objective: "Provide accurate, relevant information.",
  model: process.env.LLM_API_MODEL!,
})
class ResearcherAgent extends Agent {}

@agent({
  name: "SummarizerAgent",
  role: "Summarizer",
  description: "Summarizes information.",
  objective: "Create concise summaries.",
  model: process.env.LLM_API_MODEL!,
})
class SummarizerAgent extends Agent {}

@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@forge()
class TeamExample {
  static forge: AgentForge;

  static async run() {
    new TeamExample();
    const agents = [
      new ManagerAgent(),
      new ResearcherAgent(),
      new SummarizerAgent(),
    ];
    TeamExample.forge.registerAgents(agents);
    const team = TeamExample.forge
      .createTeam(
        "ManagerAgent",
        "Team",
        "A team of agents that can help with a variety of tasks."
      )
      .addAgents(agents);
    const result = await team.run(
      "What is the status of AI in 2025? Make a full report and summary.",
      { verbose: true }
    );
    console.log(result.output);
  }
}

TeamExample.run();
```

### 2. Workflows: Step-by-Step Task Automation

Agent Forge supports workflows, allowing you to define a sequence of agent steps for complex, multi-stage tasks. Workflows are ideal when you want to chain agent outputs, such as research followed by summarization.

```ts
import { forge, llmProvider, agent, readyForge } from "agent-forge";
import { AgentForge, Agent, LLMProvider } from "agent-forge";
import * as dotenv from "dotenv";

dotenv.config();

@agent({
  name: "Researcher",
  role: "Research Specialist",
  description: "A specialized agent for gathering and analyzing information.",
  objective: "Find accurate and relevant information on requested topics.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.4,
})
class ResearcherAgent extends Agent {}

@agent({
  name: "Summarizer",
  role: "Concise Summarizer",
  description:
    "An agent that specializes in distilling information into clear summaries.",
  objective: "Create concise, accurate summaries of complex information.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.4,
})
class SummarizerAgent extends Agent {}

@llmProvider(process.env.LLM_PROVIDER as LLMProvider, {
  apiKey: process.env.LLM_API_KEY,
})
@forge()
class WorkflowExample {
  static forge: AgentForge;

  static async run() {
    await readyForge(WorkflowExample);
    const agents = [new ResearcherAgent(), new SummarizerAgent()];
    WorkflowExample.forge.registerAgents(agents);

    // Create a workflow: research, then summarize
    const workflow = WorkflowExample.forge.createWorkflow(
      "Research and Summarize",
      "Research a topic and then summarize the findings"
    );
    workflow.addStep(agents[0]); // Researcher
    workflow.addStep(agents[1]); // Summarizer

    const result = await workflow.run(
      "What is quantum computing and how might it affect cybersecurity?",
      { verbose: true }
    );
    console.log("Workflow Result:", result.output);
  }
}

WorkflowExample.run();
```

**What this does:**

- Defines two agents: a Researcher and a Summarizer.
- Registers them with the forge instance.
- Creates a workflow where the Researcher investigates a topic, and the Summarizer condenses the findings.
- Runs the workflow on a sample question and prints the result.

### 3. Expose an Agent as a Remote A2A Server

```ts
import { a2aServer, agent, llmProvider } from "agent-forge";
import { Agent } from "agent-forge";

@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@a2aServer({ port: 41241, host: "localhost", endpoint: "/a2a", verbose: true })
@agent({
  name: "HelpfulAssistantAgent",
  role: "Helpful Assistant",
  description: "An AI assistant that tries to be helpful, hosted via A2A.",
  objective: "To answer questions and perform tasks as a helpful AI assistant.",
  model: process.env.LLM_API_MODEL!,
})
export class HelpfulAssistantAgent extends Agent {}

new HelpfulAssistantAgent();
console.log("A2A server started. Press Ctrl+C to stop.");
```

### 4. Connect to a Remote Agent (A2A Client)

```ts
import { a2aClient } from "agent-forge";
import { Agent } from "agent-forge";

@a2aClient({ serverUrl: "http://localhost:41241/a2a" })
export class RemoteHelpfulAssistant extends Agent {}

(async () => {
  const remoteAgent = await new RemoteHelpfulAssistant();
  const result = await remoteAgent.run("Summarize the latest AI trends.");
  console.log(result.output);
})();
```

### 5. Team with a Remote Agent as a Member

```ts
import { forge, llmProvider, agent, a2aClient } from "agent-forge";
import { AgentForge, Agent } from "agent-forge";

@agent({
  name: "ManagerAgent",
  role: "Manager",
  description: "Delegates tasks to team members.",
  objective: "Coordinate the team to solve complex tasks.",
  model: process.env.LLM_API_MODEL!,
})
class ManagerAgent extends Agent {}

@agent({
  name: "SummarizerAgent",
  role: "Summarizer",
  description: "Summarizes information.",
  objective: "Create concise summaries.",
  model: process.env.LLM_API_MODEL!,
})
class SummarizerAgent extends Agent {}

@a2aClient({ serverUrl: "http://localhost:41241/a2a" })
class RemoteHelpfulAssistant extends Agent {}

@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@forge()
class TeamWithRemoteExample {
  static forge: AgentForge;

  static async run() {
    new TeamWithRemoteExample();
    const remoteAgent = await new RemoteHelpfulAssistant();
    const agents = [new ManagerAgent(), new SummarizerAgent(), remoteAgent];
    TeamWithRemoteExample.forge.registerAgents(agents);
    const team = TeamWithRemoteExample.forge
      .createTeam("ManagerAgent", "Hybrid Team", "A team with a remote agent")
      .addAgents(agents);
    const result = await team.run(
      "What are the most important AI trends in 2025? Summarize the findings.",
      { verbose: true }
    );
    console.log(result.output);
  }
}

TeamWithRemoteExample.run();
```

### 5. Using Tools with Agents

Agent Forge provides a powerful tool system that allows agents to interact with external systems, APIs, and services. Tools can be added to agents using the `@tool` decorator.

#### Adding Tools with the `@tool` Decorator

```ts
import { agent, tool, llmProvider, forge } from "agent-forge";
import {
  Agent,
  AgentForge,
  WebSearchTool,
  WebPageContentTool,
} from "agent-forge";

@tool(WebSearchTool)
@tool(WebPageContentTool)
@agent({
  name: "ResearchAgent",
  role: "Research Assistant",
  description:
    "An agent that can search the web and extract content from pages.",
  objective: "Help users find and analyze information from the web.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.7,
})
class ResearchAgent extends Agent {}

@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@forge()
class ToolExample {
  static forge: AgentForge;

  static async run() {
    const agent = new ResearchAgent();
    ToolExample.forge.registerAgent(agent);

    const result = await ToolExample.forge.runAgent(
      "ResearchAgent",
      "Search for the latest developments in quantum computing and summarize the findings"
    );
    console.log(result.output);
  }
}

ToolExample.run();
```

#### Creating Custom Tools

You can create custom tools by extending the `Tool` base class:

```ts
import { Tool } from "agent-forge";
import { ToolParameter } from "agent-forge";

class CalculatorTool extends Tool {
  constructor() {
    const parameters: ToolParameter[] = [
      {
        name: "expression",
        type: "string",
        description: "The mathematical expression to evaluate",
        required: true,
      },
    ];

    super(
      "Calculator",
      "Evaluate mathematical expressions",
      parameters,
      "The result of the evaluated expression"
    );
  }

  protected async run(params: { expression: string }): Promise<any> {
    try {
      // Note: In production, use a proper math parser instead of eval
      const result = eval(params.expression);
      return { result, expression: params.expression };
    } catch (error) {
      return {
        error: `Failed to evaluate expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

class WeatherTool extends Tool {
  constructor() {
    const parameters: ToolParameter[] = [
      {
        name: "location",
        type: "string",
        description: "The location to get weather for",
        required: true,
      },
      {
        name: "units",
        type: "string",
        description: "Temperature units (celsius or fahrenheit)",
        required: false,
        default: "celsius",
      },
    ];

    super(
      "Weather",
      "Get current weather information for a location",
      parameters,
      "Weather information including temperature, conditions, and forecast"
    );
  }

  protected async run(params: {
    location: string;
    units?: string;
  }): Promise<any> {
    // This is a mock implementation. In production, call a real weather API
    const { location, units = "celsius" } = params;

    return {
      location,
      temperature: units === "celsius" ? "22°C" : "72°F",
      conditions: "Partly cloudy",
      forecast: "Sunny tomorrow",
      humidity: "65%",
      windSpeed: "10 km/h",
    };
  }
}

// Use the custom tools with an agent
@tool(CalculatorTool)
@tool(WeatherTool)
@agent({
  name: "Assistant",
  role: "General Assistant",
  description: "A helpful assistant with calculator and weather capabilities.",
  objective: "Help users with calculations and weather information.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.7,
})
class AssistantAgent extends Agent {}
```

#### Tool Requirements

When creating custom tools, follow these guidelines:

1. **Extend the Tool base class**: Your tool must inherit from `Tool`
2. **Define parameters**: Specify what parameters your tool accepts using `ToolParameter[]`
3. **Implement the `run` method**: This is where your tool's logic goes
4. **Handle errors gracefully**: Return error information instead of throwing when possible
5. **Return structured data**: Return objects that the LLM can easily understand and use

#### Tool Parameter Types

Supported parameter types:

- `string`: Text input
- `number`: Numeric input
- `boolean`: True/false values
- `array`: List of values
- `object`: Structured data

```ts
const parameters: ToolParameter[] = [
  {
    name: "query",
    type: "string",
    description: "The search query",
    required: true,
  },
  {
    name: "maxResults",
    type: "number",
    description: "Maximum number of results to return",
    required: false,
    default: 10,
  },
  {
    name: "includeImages",
    type: "boolean",
    description: "Whether to include images in results",
    required: false,
    default: false,
  },
];
```

### 6. Team with MCP Tool Agent

```ts
import { agent, llmProvider, forge, MCP, RateLimiter } from "agent-forge";
import { Agent, AgentForge } from "agent-forge";
import { MCPProtocolType } from "agent-forge/tools/mcp-tool";

@RateLimiter({
  rateLimitPerSecond: 1,
  toolSpecificLimits: {
    brave: { rateLimitPerSecond: 1 },
  },
  verbose: true,
})
@MCP(MCPProtocolType.STDIO, {
  command: "docker",
  args: ["run", "-i", "--rm", "-e", "BRAVE_API_KEY", "mcp/brave-search"],
  env: {
    BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
  },
  verbose: true,
})
@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@agent({
  name: "ResearcherAgent",
  role: "Research Specialist",
  description: "Finds and analyzes information using Brave Search.",
  objective: "Provide accurate, up-to-date information using tools.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.2,
})
class ResearcherAgent extends Agent {}

@agent({
  name: "SummarizerAgent",
  role: "Summarizer",
  description: "Summarizes research findings.",
  objective: "Create concise summaries of research results.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.4,
})
class SummarizerAgent extends Agent {}

@agent({
  name: "ManagerAgent",
  role: "Manager",
  description: "Delegates tasks to team members.",
  objective: "Coordinate the team to solve complex tasks.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.7,
})
class ManagerAgent extends Agent {}

@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@forge()
class TeamWithMCPExample {
  static forge: AgentForge;

  static async run() {
    new TeamWithMCPExample();
    const agents = [
      new ManagerAgent(),
      new ResearcherAgent(),
      new SummarizerAgent(),
    ];
    TeamWithMCPExample.forge.registerAgents(agents);
    const team = TeamWithMCPExample.forge
      .createTeam(
        "ManagerAgent",
        "Research Team",
        "A team with MCP-powered research"
      )
      .addAgents(agents);
    const result = await team.run(
      "What are the latest breakthroughs in quantum computing? Summarize the findings.",
      { verbose: true }
    );
    console.log(result.output);
  }
}

TeamWithMCPExample.run();
```

## Decorators Reference

- `@agent(config)`: Attach agent config to a class.
- `@tool(ToolClass)`: Add a tool to an agent. Can be used multiple times to add multiple tools.
- `@llmProvider(provider, config)`: Set LLM provider for a class.
- `@forge()`: Attach a static AgentForge instance to a class.
- `@a2aServer(options)`: Expose an agent as an A2A server.
- `@a2aClient(options)`: Connect an agent to a remote A2A server.
- `@MCP(protocol, config)`: Attach MCP tools to an agent.
- `@RateLimiter(config)`: Add rate limiting to an agent's tool usage.
- `@Visualizer()`: Enable timeline visualization for team runs. When used above `@forge` and `@llmProvider`, it will automatically generate an interactive HTML timeline of all agent, manager, and task events after each run.

**Usage Example:**

```ts
import { Visualizer, forge, llmProvider, agent, tool } from "agent-forge";
import { AgentForge, Agent, WebSearchTool } from "agent-forge";

@tool(WebSearchTool)
@agent({
  name: "ManagerAgent",
  role: "Manager",
  description: "Delegates tasks to team members.",
  objective: "Coordinate the team to solve complex tasks.",
  model: process.env.LLM_API_MODEL!,
})
class ManagerAgent extends Agent {}

@llmProvider("openai", { apiKey: process.env.LLM_API_KEY })
@Visualizer()
@forge()
class TeamWithTimeline {
  static forge: AgentForge;
  // ...
}
```

After running a team, an HTML timeline file will be written to the current directory (e.g., `team-run-timeline.html`).

## Documentation

- See the [docs/](docs/) directory for full documentation, API reference, and advanced usage.
- Example projects: `src/examples/`

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

MIT

**Agent Forge**: Build, orchestrate, and scale AI agents and teams.
