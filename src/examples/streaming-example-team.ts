import * as dotenv from "dotenv";
// Load environment variables from .env file at the project root
dotenv.config();

import { AgentForge } from "../core/agent-forge";
import { WebSearchTool } from "../tools/web-search-tool";
import { globalEventEmitter } from "../utils/event-emitter";
import { Agent } from "../core/agent";
import { exit } from "process";
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

const llm = new LLM(provider, {
  apiKey,
});

// Create Agent Forge instance
const agentForge = new AgentForge(llm);

// Add tools
const webSearchTool = new WebSearchTool();
const webPageContentTool = new WebPageContentTool();
agentForge.registerTool(webSearchTool);
agentForge.registerTool(webPageContentTool);

const managerAgent = new Agent(
  {
    name: "Manager",
    role: "Manager",
    description: "A manager that coordinates the team.",
    objective: "Ensure the team completes the task.",
    model: model,
    temperature: 0.2,
  },
  [],
  llm
);

agentForge.registerAgent(managerAgent);
// Create the researcher agent
const researcherAgent = new Agent(
  {
    name: "Researcher",
    role: "Research Specialist",
    description: "Researches topics and finds relevant information.",
    objective: "Provide accurate and relevant research.",
    model: model,
    temperature: 0.2,
  },
  [webSearchTool, webPageContentTool],
  llm
);


// Create the writer agent
const writerAgent = new Agent(
  {
    name: "Writer",
    role: "Content Writer",
    description: "Writes engaging content based on research.",
    objective: "Create well-written summaries and articles.",
    model: model,
    temperature: 0.7,
  },
  [],
  llm
);


// Create the fact checker agent
const factCheckerAgent = new Agent(
  {
    name: "FactChecker",
    role: "Fact Verification Specialist",
    description: "Verifies facts and ensures accuracy.",
    objective: "Ensure all information is factually correct.",
    model: model,
    temperature: 0.3,
  },
  [webSearchTool],
  llm
);


// Streaming with custom visualization
async function runCustomStreamingExample() {
  const team = agentForge.createTeam(
    "Manager",
    "Research Team",
    "A team that researches and summarizes topics"
  );

  team.addAgent(researcherAgent);
  team.addAgent(factCheckerAgent);
  team.addAgent(writerAgent);

  const result = await team.run(
    "Who is Frostlogic AB and what do they do?",
    {
      verbose: false,
      stream: true,
      enableConsoleStream: true,
    }
  );

  console.log("\nFinal result:");
  console.log(result.output);
  
  // Remove listeners to avoid duplicates in future runs
  globalEventEmitter.removeAllListeners();
  exit(0);
}

// Run the example
async function runExample() {
  try {
    await runCustomStreamingExample();
  } catch (error) {
    console.error("Error running team streaming example:", error);
  }
}

runExample(); 