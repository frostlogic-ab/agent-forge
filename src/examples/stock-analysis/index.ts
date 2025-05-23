import dotenv from "dotenv";
import { AgentForge, Agent, LLM, MCPManager, createMCPClient, MCPProtocolType, Team, MCPClientWrapper } from "../../index";
import { LLMProvider } from "../../types";
import { ensureDockerContainers } from "./setup-docker";

// Load environment variables from .env file at the project root
dotenv.config();

async function main() {
  // Check for API key
  const provider = process.env.LLM_PROVIDER as LLMProvider;
  const apiKey = process.env.LLM_API_KEY!;
  const model = process.env.LLM_API_MODEL!;

  if (!apiKey) {
    console.error(
        `Error: LLM_API_KEY environment variable not set. ` +
        "Please create a .env file in the project root (from .env.sample) " +
        "and add your LLM_API_KEY (and optionally LLM_PROVIDER, LLM_MODEL)."
    );
    process.exit(1);
  }

  let mcpManager: MCPManager | null = null;
  let mcpBraveSearch: MCPClientWrapper | null = null;

  try {
    // Ensure Docker is running and containers are available
    await ensureDockerContainers();
    
    // Create LLM provider
    const llmProvider = new LLM(provider, {
      apiKey,
    });

    // Create the Agent Forge instance
    const forge = new AgentForge(llmProvider);

    // Create and verify MCP clients
    mcpManager = new MCPManager({
      // Global defaults
      rateLimitPerSecond: 1, // conservative global limit
      // Tool-specific limits
      toolSpecificLimits: {
        'brave': {
          rateLimitPerSecond: 1  // Brave API allows 1 query per second
        }
      },
      verbose: true
    });
    
    // Create the MCP client for Brave Search
    mcpBraveSearch = createMCPClient(MCPProtocolType.STDIO, {
      command: "docker",
      args: ["run", "-i", "--rm", "-e", "BRAVE_API_KEY", "mcp/brave-search"],
      env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
      },
      verbose: true
    });
  
    // Add clients to manager
    mcpManager.addClient(mcpBraveSearch);
  
    // Wait for tools to be registered - needed to give enough time for the docker containers to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const mcpTools = mcpManager.getTools();
    
    // Create a research agent
    const researchAgent = new Agent(
        {
            name: "Financial researcher",
            role: "You are a world class research analyst.",
            description:
            `Uses tools to find information about a company.`,
            objective: `Use Brave Search and Fetch tools to find information about the company.

            Todays date is ${new Date().toISOString().split('T')[0]}. Make sure to use this date in your search queries and in the report, don't include news or financial data that are too old. 
            Don't simulate or make up data for illustration purposes, nor create hypothetical data/analysis.

            ## How to use your tools
          
            ### Brave Search tool
            Execute these exact search queries:
            1. "{COMPANY_NAME} stock price today"
            2. "{COMPANY_NAME} latest quarterly earnings"
            3. "{COMPANY_NAME} financial news"
            4. "{COMPANY_NAME} earnings expectations"
            
            ### Data extraction
            Extract the most relevant information about:
            - Current stock price and recent movement
            - Latest earnings report data
            - Any significant recent news with correct citations
            
            ### Guidelines
            Be smart and concise. Keep responses as detailed as possible and focused on facts.`,
            model: model,
            temperature: 0.1,
        },
        mcpTools,
        llmProvider
    );

    const analystAgent = new Agent(
      {
        name: "Financial analyst",
        role: "You are a world class financial analyst.",
        description: "Analyzes financial data on a company and returns a report of the analysis.",
        objective:
        `
          Analyze the key financial data for the company:
            1. Note if stock is up or down and by how much (percentage and dollar amount)
            2. Check if earnings beat or missed expectations (by how much)
            3. List 1-2 main strengths and concerns based on the data
            4. Include any analyst recommendations mentioned in the data
            5. Include any other relevant information that is not covered in the other criteria
            Be specific with numbers and cite any sources of information
        `,
        model: model,
        temperature: 0.4
      }
    )

    const writerAgent = new Agent(
      {
        name: "Report writer",
        role: "You are a world class financial report writer.",
        description: "Writes a professional stock report for the researched company.",
        objective: 
        `
        Create a professional stock report for the company:

            Start with a professional header with company name and current date.
            Then in a table format, list the following information:
            - Current stock price and recent movement
            - Latest earnings results and performance vs expectations
            - 1-2 main strengths and concerns based on the data
            
            Create a professional report with the following sections:
            1. Professional header with company name and current date
            2. Brief company description (1-2 sentences)
            3. Current stock performance section with price and recent movement
            4. Latest earnings results section with key metrics
            5. Recent news section with bullet points for relevant developments
            6. Brief outlook and recommendation section
            7. Sources and references section listing all cited sources
            
            Format as clean markdown with appropriate headers and sections.
            Include exact figures with proper formatting (e.g., $XXX.XX, XX%).
            Keep under 800 words total.
        `,
        model: model,
        temperature: 0.4
      }
    )

    const orchestratorAgent = new Agent(
      {
        name: "Team manager",
        role: "Team manager",
        description: "You are a world class financial project manager",
        objective: 
        `
        Use your team of agents to complete the research report for the requested company. 

        ## Workflow
          1. Plan and assign tasks to the agents.
          2. If you need to, you can ask the agents to do a job multiple times.
          3. Don't let the agents work on the same job at the same time.
          4. Always check with the research evaluator agent the work of the Financial Researcher agent.
          5. If the financial analyst agent returns a report, ask the report writer agent to write the report.
          6. If the report writer agent returns a report, return the final report to the user.

        ## Important
        - Return final response as-is from Report Writer agent.
        `,
        model: model
      }
    )

    forge.registerAgent(researchAgent);
    forge.registerAgent(analystAgent);
    forge.registerAgent(writerAgent);
    forge.registerAgent(orchestratorAgent);

    const team = new Team(
      orchestratorAgent, "Stock Analysis Team", "A team of agents to analyze a company's stock"
    )

    team.addAgent(researchAgent);
    team.addAgent(analystAgent);
    team.addAgent(writerAgent);
    
    const result = await team.run(
      "Do a stock analysis for TSLA",
      {
        verbose: true,
        enableConsoleStream: true,
        stream: true,
        // Add rate limiting to avoid API rate limit errors
        rate_limit: 10
      }
    )

    console.log(result);
    
  } catch (error) {
    console.error("Fatal error in main():", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    console.error("Error:", error);
  } finally {
    // Ensure all resources are properly cleaned up
    try {
      if (mcpBraveSearch) {
        mcpBraveSearch.close();
      }
      if (mcpManager) {
        await mcpManager.close();
      }
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }
    process.exit(0);
  }
}

main();
