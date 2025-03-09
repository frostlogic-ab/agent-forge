# Agent Forge Tools

This directory contains the tools that can be used by agents in the Agent Forge framework.

## Available Tools

### WebPageContentTool

A tool for fetching and extracting the text content of a webpage.

**Features:**

- Retrieves the full HTML content of a webpage
- Extracts the main text content from the page
- Cleans and formats the text for better readability
- Handles common issues like HTTP errors, redirects, etc.
- Removes irrelevant content such as navigation, footers, ads, etc.
- Implements caching to avoid redundant requests
- Includes rate limiting to avoid overloading servers

**Parameters:**

- `url` (string, required): The URL of the webpage to extract content from
- `extractMainContent` (boolean, optional, default: true): Whether to extract only the main content or return the full HTML

**Example Usage:**

```typescript
import { WebPageContentTool } from "../tools/web-page-content-tool";

// Create the tool instance
const webPageContentTool = new WebPageContentTool();

// Execute the tool
const result = await webPageContentTool.execute({
  url: "https://en.wikipedia.org/wiki/Artificial_intelligence",
  extractMainContent: true,
});

console.log(result.content);
```

**Using with an Agent:**

```typescript
import { Agent, OpenAIProvider, WebPageContentTool } from "../";

// Create the tool instance
const webPageContentTool = new WebPageContentTool();

// Create an agent that can use the tool
const agent = new Agent(
  {
    name: "Web Content Analyst",
    role: "Research Assistant",
    description:
      "I extract and analyze content from web pages to answer questions.",
    objective: "Help users extract and understand content from websites.",
    model: "gpt-4-turbo",
    temperature: 0.2,
    tools: [webPageContentTool.getConfig()],
  },
  [webPageContentTool],
  llmProvider
);

// Run the agent with a query that uses the tool
const result = await agent.run(
  "Extract the content from https://en.wikipedia.org/wiki/Artificial_intelligence and provide a brief summary of what AI is."
);
```

### WebSearchTool

A tool for performing web searches using Searx.

**Features:**

- Uses Searx, a free, privacy-respecting metasearch engine
- Supports multiple Searx instances for redundancy
- Includes caching and rate limiting
- Returns search results with titles, snippets, and links

**Parameters:**

- `query` (string, required): The search query
- `numResults` (number, optional, default: 5): Number of results to return

### SECApiTool

A tool for retrieving financial data from the SEC API.

**Features:**

- Retrieves financial filings and data from the SEC
- Supports various filing types and search parameters
- Includes caching and rate limiting

**Parameters:**

- Various parameters depending on the specific SEC API endpoint being used

## Creating Custom Tools

To create a custom tool, extend the `Tool` base class and implement the `run` method:

```typescript
import { Tool } from "./tool";
import type { ToolParameter } from "../types";

export class MyCustomTool extends Tool {
  constructor() {
    const parameters: ToolParameter[] = [
      {
        name: "param1",
        type: "string",
        description: "Description of parameter 1",
        required: true,
      },
      {
        name: "param2",
        type: "number",
        description: "Description of parameter 2",
        required: false,
        default: 42,
      },
    ];

    super(
      "MyCustomTool",
      "Description of what my tool does",
      parameters,
      "Description of what my tool returns"
    );
  }

  protected async run(params: {
    param1: string;
    param2?: number;
  }): Promise<any> {
    // Implement your tool's functionality here
    const { param1, param2 = 42 } = params;

    // Return the result
    return {
      result: `Processed ${param1} with value ${param2}`,
    };
  }
}
```

Then register your tool with the `ToolRegistry` or use it with an agent:

```typescript
// Register with ToolRegistry
const toolRegistry = new ToolRegistry();
toolRegistry.register(new MyCustomTool());

// Or use with an agent
const agent = new Agent(
  {
    // Agent config...
    tools: [new MyCustomTool().getConfig()],
  },
  [new MyCustomTool()],
  llmProvider
);
```
