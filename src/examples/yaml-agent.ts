import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { AgentForge, OpenAIProvider, loadAgentFromYaml } from "../index";

// Load environment variables
dotenv.config();

// Create example YAML files if they don't exist
async function createExampleYamlFiles() {
  const examplesDir = path.join(__dirname, "yaml");

  try {
    await fs.mkdir(examplesDir, { recursive: true });

    // Research agent YAML
    const researchAgentYaml = `
name: Researcher
role: Research Specialist
description: A specialized agent for gathering and analyzing information
objective: Find accurate and relevant information on requested topics
model: gpt-4
temperature: 0.7
tools:
  - name: WebSearch
    description: Search the web for information
    parameters:
      - name: query
        type: string
        description: The search query
        required: true
`;

    // Summary agent YAML
    const summaryAgentYaml = `
name: Summarizer
role: Concise Summarizer
description: An agent that specializes in distilling information into clear summaries
objective: Create concise, accurate summaries of complex information
model: gpt-3.5-turbo
temperature: 0.5
`;

    // Manager agent YAML
    const managerAgentYaml = `
name: Manager
role: Team Manager
description: An agent that coordinates other agents to complete complex tasks
objective: Effectively delegate tasks and synthesize results from specialized agents
model: gpt-4
temperature: 0.7
`;

    // Write the YAML files
    await fs.writeFile(
      path.join(examplesDir, "researcher.yaml"),
      researchAgentYaml
    );
    await fs.writeFile(
      path.join(examplesDir, "summarizer.yaml"),
      summaryAgentYaml
    );
    await fs.writeFile(
      path.join(examplesDir, "manager.yaml"),
      managerAgentYaml
    );

    console.log("Example YAML files created successfully");
  } catch (error) {
    console.error("Error creating example YAML files:", error);
  }
}

async function main() {
  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable not set");
    process.exit(1);
  }

  try {
    // Create example YAML files
    await createExampleYamlFiles();

    // Create an LLM provider
    const llmProvider = new OpenAIProvider({
      apiKey,
    });

    // Create the Agent Forge instance
    const forge = new AgentForge(llmProvider);

    // Load agents from YAML files
    const examplesDir = path.join(__dirname, "yaml");
    const researcherYamlPath = path.join(examplesDir, "researcher.yaml");
    const summarizerYamlPath = path.join(examplesDir, "summarizer.yaml");
    const managerYamlPath = path.join(examplesDir, "manager.yaml");

    console.log("Loading agents from YAML files...");

    const researchAgent = await loadAgentFromYaml(researcherYamlPath);
    researchAgent.setLLMProvider(llmProvider);

    const summaryAgent = await loadAgentFromYaml(summarizerYamlPath);
    summaryAgent.setLLMProvider(llmProvider);

    const managerAgent = await loadAgentFromYaml(managerYamlPath);
    managerAgent.setLLMProvider(llmProvider);

    // Register the agents
    forge.registerAgent(researchAgent);
    forge.registerAgent(summaryAgent);
    forge.registerAgent(managerAgent);

    console.log("Agents loaded successfully:");
    forge.getAgents().forEach((agent) => {
      console.log(`- ${agent.name} (${agent.role}): ${agent.description}`);
    });

    // Method 1: Run a single agent
    console.log("\nRunning research agent...");
    const researchResult = await forge.runAgent(
      "Researcher",
      "What are the latest breakthroughs in quantum computing?"
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
      "Explain the current state of AI safety research"
    );
    console.log("\nWorkflow Result:");
    console.log(workflowResult.output);
    console.log(
      `\nToken usage: ${workflowResult.metadata.tokenUsage?.total || 0} tokens`
    );

    // Method 3: Load all agents from a directory
    console.log("\n\nLoading all agents from directory...");
    await forge.loadAgentsFromDirectory(examplesDir);
    console.log("All agents loaded successfully");
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
