import * as dotenv from "dotenv";
import { AgentForge, Agent, LLM } from "../index";
import { LLMProvider } from "../types";

// Load environment variables from .env file at the project root
dotenv.config();

async function main() {
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

  try {
    // Create an LLM provider
    const llmProvider = await LLM.create(provider, {
      apiKey,
    });

    // Create the Agent Forge instance
    const forge = new AgentForge(llmProvider);

    // Create a research agent
    const researchAgent = new Agent(
      {
        name: "Researcher",
        role: "Research Specialist",
        description:
          "A specialized agent for gathering and analyzing information.",
        objective:
          "Find accurate and relevant information on requested topics.",
        model: model, // Use the model from .env or default
        temperature: 0.4,
      },
      [],
      llmProvider
    );

    // Create a summarization agent
    const summaryAgent = new Agent(
      {
        name: "Summarizer",
        role: "Concise Summarizer",
        description:
          "An agent that specializes in distilling information into clear summaries.",
        objective: "Create concise, accurate summaries of complex information.",
        model: model, // Use the model from .env or default
        temperature: 0.4,
      },
      [],
      llmProvider
    );

    // Register the agents
    forge.registerAgent(researchAgent);
    forge.registerAgent(summaryAgent);

    // Method 1: Run a single agent
    console.log("Running research agent...");
    const researchResult = await forge.runAgent(
      "Researcher",
      "What are the major developments in AI in 2023?"
    );
    console.log("\nResearch Result:");
    console.log(researchResult.output);
    console.log(
      `\nToken usage: ${researchResult.metadata.tokenUsage?.total || 0} tokens`
    );

    // Method 2: Create and run a workflow (sequential)
    console.log("\n\nRunning workflow (sequential agents)...");
    const workflow = forge.createWorkflow(
      "Research and Summarize",
      "Research a topic and then summarize the findings"
    );
    workflow.addStep(researchAgent);
    workflow.addStep(summaryAgent);

    const workflowResult = await workflow.run(
      "Explain the impact of large language models on software development"
    );
    console.log("\nWorkflow Result:");
    console.log(workflowResult.output);
    console.log(
      `\nToken usage: ${workflowResult.metadata.tokenUsage?.total || 0} tokens`
    );

    // Method 3: Create and run a team (hierarchical)
    console.log("\n\nRunning team (hierarchical agents)...");

    // Create a manager agent
    const managerAgent = new Agent(
      {
        name: "Manager",
        role: "Team Manager",
        description:
          "An agent that coordinates other agents to complete complex tasks.",
        objective:
          "Effectively delegate tasks and synthesize results from specialized agents.",
        model: model, // Use the model from .env or default
        temperature: 0.7,
      },
      [],
      llmProvider
    );

    forge.registerAgent(managerAgent);

    const team = forge.createTeam(
      "Manager",
      "Research Team",
      "A team that researches and summarizes topics"
    );
    team.addAgent(researchAgent);
    team.addAgent(summaryAgent);

    const teamResult = await team.run(
      "What is quantum computing and how might it affect cybersecurity?",
      { 
        rate_limit: 10,  // Limit to 10 LLM calls per minute to avoid rate limit errors
        verbose: true     // Enable detailed logging of team interactions
      }
    );
    console.log("\nTeam Result:");
    console.log(teamResult.output);
    console.log(
      `\nToken usage: ${teamResult.metadata.tokenUsage?.total || 0} tokens`
    );
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
