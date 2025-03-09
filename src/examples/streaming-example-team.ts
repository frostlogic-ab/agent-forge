import * as dotenv from "dotenv";
dotenv.config();

import { AgentForge } from "../core/agent-forge";
import { OpenAIProvider } from "../llm/providers/open-ai-provider";
import { WebSearchTool } from "../tools/web-search-tool";
import { AgentForgeEvents } from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { Agent } from "../core/agent";
import { exit } from "process";
import { WebPageContentTool } from "../tools/web-page-content-tool";

// Create an LLM provider with your API key
const llmProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create Agent Forge instance
const agentForge = new AgentForge(llmProvider);

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
    model: "gpt-3.5-turbo",
    temperature: 0.2,
  },
  [],
  llmProvider
);

agentForge.registerAgent(managerAgent);
// Create the researcher agent
const researcherAgent = new Agent(
  {
    name: "Researcher",
    role: "Research Specialist",
    description: "Researches topics and finds relevant information.",
    objective: "Provide accurate and relevant research.",
    model: "gpt-3.5-turbo", 
    temperature: 0.2,
    tools: [webSearchTool.getConfig(), webPageContentTool.getConfig()],
  },
  [webSearchTool, webPageContentTool], // Pass tools as second argument
  llmProvider
);


// Create the writer agent
const writerAgent = new Agent(
  {
    name: "Writer",
    role: "Content Writer",
    description: "Writes engaging content based on research.",
    objective: "Create well-written summaries and articles.",
    model: "gpt-3.5-turbo",
    temperature: 0.7,
    tools: [],
  },
  [], // No tools
  llmProvider
);


// Create the fact checker agent
const factCheckerAgent = new Agent(
  {
    name: "FactChecker",
    role: "Fact Verification Specialist",
    description: "Verifies facts and ensures accuracy.",
    objective: "Ensure all information is factually correct.",
    model: "gpt-3.5-turbo",
    temperature: 0.3,
    tools: [webSearchTool.getConfig()],
  },
  [webSearchTool], // Pass tools as second argument
  llmProvider
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