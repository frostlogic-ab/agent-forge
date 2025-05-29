import * as dotenv from "dotenv";
import {
  Agent,
  agent,
  llmProvider,
  forge,
  readyForge,
  LLMProvider,
  AgentForge,
  RateLimiter,
} from "../../index";
import { RAGChromaDb } from "../../rag/decorators";

// Load environment variables
dotenv.config();

@RAGChromaDb({
  collectionName: "company_knowledge_base",
  chromaUrl: "http://localhost:8000",
  topK: 3,
  similarityThreshold: 0.1,
})
@agent({
  name: "Knowledge Assistant",
  role: "Knowledge Base Specialist",
  description: "An assistant with access to company knowledge base through RAG",
  objective: "Provide accurate information from company documents and policies",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.3,
})
class KnowledgeAssistant extends Agent {}

@RAGChromaDb({
  collectionName: "company_knowledge_base",
  chromaUrl: "http://localhost:8000",
  topK: 5,
  similarityThreshold: 0.1,
})
@agent({
  name: "Research Specialist",
  role: "Research and Analysis Expert",
  description: "Specialist in researching and analyzing information from documents",
  objective: "Conduct thorough research and provide detailed analysis",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.4,
})
class ResearchSpecialist extends Agent {}

@agent({
  name: "Team Manager",
  role: "Team Coordination Manager",
  description: "Manages team workflow and coordinates responses from different specialists",
  objective: "Coordinate team members and synthesize their expertise into comprehensive responses",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.6,
})
class TeamManager extends Agent {}

@RateLimiter({
  rateLimitPerSecond: 1,
})
@llmProvider(process.env.LLM_PROVIDER as LLMProvider, {
  apiKey: process.env.LLM_API_KEY,
})
@forge()
class RAGTeamExample {
  static forge: AgentForge;

  static async run() {
    try {
      // Initialize forge
      await readyForge(RAGTeamExample);

      // Create and register agents
      const knowledgeAssistant = new KnowledgeAssistant();
      const researchSpecialist = new ResearchSpecialist();
      const teamManager = new TeamManager();

      RAGTeamExample.forge.registerAgents([
        knowledgeAssistant,
        researchSpecialist,
        teamManager,
      ]);

      // Team workflow example - RAG will auto-initialize when agents are first used
      const team = RAGTeamExample.forge.createTeam(
        "Team Manager",
        "Knowledge Team",
        "Team of specialists with access to company knowledge base"
      );
      team.addAgents([knowledgeAssistant, researchSpecialist]);

      const teamResult = await team.run(
        "I need information about our annual leave policy and API rate limits.",
        { verbose: false, stream: false }
      );
      
      console.log("Team Response:");
      console.log(teamResult.output);
      process.exit(0);

    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}

// Main execution
if (require.main === module) {
  RAGTeamExample.run();
}

export { RAGTeamExample }; 