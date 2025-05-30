import * as dotenv from "dotenv";
// Load environment variables from .env file at the project root
dotenv.config();

import { AgentForge } from "../core/agent-forge";
import { WebSearchTool } from "../tools/web-search-tool";
import { Agent } from "../core/agent";
import { WebPageContentTool } from "../tools/web-page-content-tool";
import { LLM } from "../llm/llm";
import { LLMProvider } from "../types";

const provider = (process.env.LLM_PROVIDER as LLMProvider) || "openai";
const apiKey = process.env.LLM_API_KEY;

const model = process.env.LLM_API_MODEL!;

if (!apiKey) {
  console.error(
      `Error: LLM_API_KEY environment variable not set. ` +
      "Please create a .env file in the project root (from .env.sample) " +
      "and add your LLM_API_KEY (and optionally LLM_PROVIDER, LLM_MODEL)."
  );
  process.exit(1);
}

const llmProvider = new LLM(provider, {
  apiKey
});

// Create Agent Forge instance
const agentForge = new AgentForge(llmProvider);

// Add tools
const webSearchTool = new WebSearchTool();
const webPageContentTool = new WebPageContentTool();
agentForge.registerTool(webSearchTool);
agentForge.registerTool(webPageContentTool);

// Create the researcher agent
const researcherAgent = new Agent(
  {
    name: "Researcher",
    role: "Research Specialist",
    description: "Researches topics and finds relevant information. When you use the web search tool, always get the content of the page.",
    objective: "Provide accurate and relevant research.",
    model: model,
    temperature: 0.2,
  },
  [webSearchTool, webPageContentTool],
  llmProvider
);
agentForge.registerAgent(researcherAgent);

// Create the writer agent
const writerAgent = new Agent(
  {
    name: "Writer",
    role: "Content Writer",
    description: "Writes engaging content based on research.",
    objective: "Create well-written summaries and articles.",
    model: model,
    temperature: 0.2,
  },
  [],
  llmProvider
);
agentForge.registerAgent(writerAgent);

// Create the fact checker agent
const factCheckerAgent = new Agent(
  {
    name: "FactChecker",
    role: "Fact Verification Specialist",
    description: "Verifies facts and ensures accuracy.",
    objective: "Ensure all information is factually correct.",
    model: model,
    temperature: 0.2,
  },
  [webSearchTool],
  llmProvider
);
agentForge.registerAgent(factCheckerAgent);

// Streaming with default console visualization
async function runStreamingWorkflowExample() {
  console.log("=== Running Streaming Workflow Example ===");
  console.log("Using built-in console visualization\n");

  const result = await agentForge.runWorkflow(
    ["Researcher", "Writer", "FactChecker"],
    "Create a short summary about quantum computing advancements in 2023.",
    {
      stream: true,
      enableConsoleStream: true,
      verbose: true,
    }
  );

  console.log("\n:");
  console.log(result.output);
}

// Run the example
async function runExample() {
  try {
    await runStreamingWorkflowExample();
  } catch (error) {
    console.error("Error running workflow streaming example:", error);
  }
}

runExample(); 