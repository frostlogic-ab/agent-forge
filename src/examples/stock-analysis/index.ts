import dotenv from "dotenv";
import { AgentForge, Agent, LLM } from "../../index";
import { WebSearchTool } from "../../tools/web-search-tool";
import { SECApiTool } from "../../tools/sec-api-tool";
import { LLMProvider } from "token.js/dist/chat";

// Load environment variables
dotenv.config();

async function main() {
  // Check for API key
  const provider = process.env.LLM_PROVIDER as LLMProvider  || "openai";
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    console.error("Error: LLM_API_KEY environment variable not set");
    process.exit(1);
  }

  try {
    // Create an LLM provider
    const llmProvider = new LLM(provider, {
      apiKey,
    });

    // Create the Agent Forge instance
    const forge = new AgentForge(llmProvider);

    // Create tools to use with agents
    const webSearchTool = new WebSearchTool();
    const secApiTool = new SECApiTool();

    // Create a research agent
    const researchAgent = new Agent(
        {
            name: "News researcher",
            role: "News Researcher",
            description:
            `A specialized agent for gathering and analyzing news articles. Todays date is ${new Date().toISOString().split('T')[0]}`,
            objective: "Find accurate and relevant information for the given stock ticker and give a \
            recommendation for the stock based on the news. ",
            model: model,
            temperature: 0.1,
        },
        [webSearchTool],
        llmProvider
    );

    const financialAgent = new Agent(
        {
            name: "Financial Analyst",
            role: "Financial Analyst",
            description:
            "A specialized agent for analyzing financial data and making investment recommendations.\
             It uses the SEC API tool to get the financial data. It can use the tool multiple \
             times to get the different financial data for the given stock ticker.",
            objective: "Analyze the financial data and make investment recommendations for the given stock ticker.",
            model: model,
            temperature: 0.1,
        },
        [secApiTool],
        llmProvider
    );

    forge.registerAgent(researchAgent);
    forge.registerAgent(financialAgent);

    const workflow = forge.createWorkflow(
        "Stock Analysis",
        "Analyze the stock and give a recommendation for buy or sell, short or long, for the stock based on the \
        news and financial data. Make recommendations based on the news and financial data that you've received \
        from the research and finanacial analyst agent only."
    )

    workflow.addStep(researchAgent);
    workflow.addStep(financialAgent);

    console.log("Running stock analysis workflow with tools enabled...");

    const result = await workflow.run(
        "TSLA",
        {
            rate_limit: 10,
            verbose: true,
        }
    );

    console.log(result);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
