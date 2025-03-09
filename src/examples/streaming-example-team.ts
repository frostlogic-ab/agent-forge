import * as dotenv from "dotenv";
dotenv.config();

import { AgentForge } from "../core/agent-forge";
import { OpenAIProvider } from "../llm/providers/open-ai-provider";
import { WebSearchTool } from "../tools/web-search-tool";
import { AgentForgeEvents } from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { Agent } from "../core/agent";
import { exit } from "process";

// Create an LLM provider with your API key
const llmProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create Agent Forge instance
const agentForge = new AgentForge(llmProvider);

// Add tools
const webSearchTool = new WebSearchTool();
agentForge.registerTool(webSearchTool);

// Create the researcher agent
const researcherAgent = new Agent(
  {
    name: "Researcher",
    role: "Research Specialist",
    description: "Researches topics and finds relevant information.",
    objective: "Provide accurate and relevant research.",
    model: "gpt-3.5-turbo", 
    temperature: 0.7,
    tools: [{ 
      name: "web_search",
      description: "Search the web for information"
    }],
  },
  [webSearchTool], // Pass tools as second argument
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
    model: "gpt-3.5-turbo",
    temperature: 0.7,
    tools: [],
  },
  [], // No tools
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
    model: "gpt-3.5-turbo",
    temperature: 0.3,
    tools: [{ 
      name: "web_search",
      description: "Search the web for fact verification"
    }],
  },
  [webSearchTool], // Pass tools as second argument
  llmProvider
);
agentForge.registerAgent(factCheckerAgent);

// Streaming with custom visualization
async function runCustomStreamingExample() {
  // Custom event handlers
  globalEventEmitter.on(AgentForgeEvents.LLM_STREAM_CHUNK, (event) => {
    // Show actual content with formatting
    if (event.chunk && !event.isDelta) {
      if (event.isComplete) {
        process.stdout.write("\n"); // Add newline when stream completes
      } else {
        process.stdout.write(event.chunk);
      }
    }
  });

  // Show clear agent communication
  globalEventEmitter.on(AgentForgeEvents.AGENT_COMMUNICATION, (event) => {
    console.log(`\n\n>>AGENT COMMUNICATION: ${event.sender} ${event.recipient ? `→ ${event.recipient}` : ""}: Communication received`);
  });

  

  
  const result = await agentForge.runTeam(
    "Writer", // Manager
    ["Researcher", "FactChecker"],
    "Who is Frostlogic AB and what do they do?",
    {
      verbose: false,
      stream: true,
      enableConsoleStream: true,
    }
  );

//   console.log("\nFinal result:");
//   console.log(result.output);
  
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