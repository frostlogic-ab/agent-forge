import * as dotenv from "dotenv";
import { AgentForge, Agent, agent, llmProvider, LLMProvider, readyForge, forge } from "../index";


// Load environment variables from .env file at the project root
dotenv.config();

@agent({
  name: "Researcher",
  role: "Research Specialist",
  description:
    "A specialized agent for gathering and analyzing information.",
  objective:
    "Find accurate and relevant information on requested topics.",
  model: process.env.LLM_API_MODEL!, // Use the model from .env or default
  temperature: 0.4,
})
class ResearcherAgent extends Agent {}

@agent({
    name: "Summarizer",
    role: "Concise Summarizer",
    description:
      "An agent that specializes in distilling information into clear summaries.",
    objective: "Create concise, accurate summaries of complex information.",
    model: process.env.LLM_API_MODEL!, // Use the model from .env or default
    temperature: 0.4
})
class SummarizerAgent extends Agent {}


@agent({
  name: "Manager",
  role: "Team Manager",
  description:
    "An agent that coordinates other agents to complete complex tasks.",
  objective:
    "Effectively delegate tasks and synthesize results from specialized agents.",
  model: process.env.LLM_API_MODEL!, // Use the model from .env or default
  temperature: 0.7,
})
class ManagerAgent extends Agent {}

@llmProvider(process.env.LLM_PROVIDER as LLMProvider, {apiKey: process.env.LLM_API_KEY})
@forge()
class SimpleAgent {
  static forge: AgentForge;

  static async run() {
    await readyForge(SimpleAgent);

    const agents = [
      new ResearcherAgent(),
      new SummarizerAgent(),
      new ManagerAgent(),
    ];

    SimpleAgent.forge.registerAgents(agents);

    // Workflow example
    const workflow = SimpleAgent.forge.createWorkflow("Research and Summarize", "Research a topic and then summarize the findings");
    workflow.addStep(agents[0]);
    workflow.addStep(agents[1]);

    const workflowResult = await workflow.run("What is quantum computing and how might it affect cybersecurity?", { verbose: true });
    console.log("\nWorkflow Result:", workflowResult.output);


    // Team example
    const team = SimpleAgent.forge.createTeam("Manager", "Research Team", "A team that researches and summarizes topics");
    team.addAgents(agents);

    const teamResult = await team.run("What is quantum computing and how might it affect cybersecurity?", { verbose: true });
    console.log("\nTeam Result:", teamResult.output);

    process.exit(0);
  }
}

SimpleAgent.run();
