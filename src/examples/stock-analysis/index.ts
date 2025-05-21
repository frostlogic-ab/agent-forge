import dotenv from "dotenv";
import { AgentForge, Agent, LLM, MCPManager, createMCPClient, MCPProtocolType, Team } from "../../index";
import { LLMProvider } from "../../types";

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

  try {
    // Create an LLM provider
    const llmProvider = new LLM(provider, {
      apiKey,
    });

    // Create the Agent Forge instance
    const forge = new AgentForge(llmProvider);

    // Create the MCP manager 
    const mcpManager = new MCPManager();
    // Create the MCP client for Alpha Vantage
    const mcpFetch = createMCPClient(MCPProtocolType.STDIO, {
      command: "docker",
      args: ["run", "-i", "mcp/fetch"],
      verbose:true
    })
    // Create the MCP client for Brave Search
    const mcpBraveSearch = createMCPClient(MCPProtocolType.STDIO, {
      command: "docker",
      args: ["run", "-i", "--rm", "-e", "BRAVE_API_KEY", "mcp/brave-search"],
      env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
      },
      verbose: true
    })

    mcpManager.addClient(mcpFetch);
    mcpManager.addClient(mcpBraveSearch);

    // Get the tools from the Alpha Vantage MCP manager
    const mcpTools = mcpManager.getTools();

    // Create a research agent
    const researchAgent = new Agent(
        {
            name: "Financial researcher",
            role: "Financial Researcher",
            description:
            `You are a world class research analyst.`,
            objective: `Use Brave Search and Fetch tools to find information about the company.

            Todays date is ${new Date().toISOString().split('T')[0]}. Make sure to use this date in your search queries and in the report, don't include news or financial data that are too old. 
            Don't simulate or make up data for illustration purposes, nor create hypothetical data/analysis.
            Use the fetch tool to read the web pages that Brave Search returns.

            Execute these exact search queries:
            1. "{COMPANY_NAME} stock price today"
            2. "{COMPANY_NAME} latest quarterly earnings"
            3. "{COMPANY_NAME} financial news"
            4. "{COMPANY_NAME} earnings expectations"
            
            Extract the most relevant information about:
            - Current stock price and recent movement
            - Latest earnings report data
            - Any significant recent news with correct citations
            
            Be smart and concise. Keep responses short and focused on facts.`,
            model: model,
            temperature: 0.1,
        },
        mcpTools,
        llmProvider
    );

    const researchEvaluator = new Agent(
      {
        name: "Research evaluator",
        role: "Research evaluator",
        description: "You are an expert research evaluator specializing in financial data quality.",
        objective: `
          Evaluate the research data on the company based on these criteria:
            
            1. Accuracy: Are facts properly cited with source URLs? Are numbers precise?
            2. Completeness: Is all required information present? (stock price, earnings data, recent news)
            3. Specificity: Are exact figures provided rather than generalizations?
            4. Clarity: Is the information organized and easy to understand?
            
            For each criterion, provide a rating:
            - EXCELLENT: Exceeds requirements, highly reliable
            - GOOD: Meets all requirements, reliable
            - FAIR: Missing some elements but usable
            - POOR: Missing critical information, not usable
            
            Provide an overall quality rating and specific feedback on what needs improvement.
            If any critical financial data is missing (stock price, earnings figures), the overall
            rating should not exceed FAIR.
        `,
        model: model,
        temperature: 0.4
      }
    )

    const analystAgent = new Agent(
      {
        name: "Financial analyst",
        role: "Financial analyst",
        description: "You are a world class financial analyst.",
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
        role: "Report writer",
        description: "You are a world class financial report writer.",
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
          5. If the research evaluator agent returns a rating of POOR, ask the research agent to improve the report.
          6. If the research evaluator agent returns a rating of GOOD or EXCELLENT, ask the financial analyst agent to analyze the report.
          7. If the financial analyst agent returns a report, ask the report writer agent to write the report.
          8. If the report writer agent returns a report, return the final report to the user.
          
        `,
        model: model
      }
    )

    forge.registerAgent(researchAgent);
    forge.registerAgent(researchEvaluator);
    forge.registerAgent(analystAgent);
    forge.registerAgent(writerAgent);
    forge.registerAgent(orchestratorAgent);

    const team = new Team(
      orchestratorAgent, "Stock Analysis Team", "A team of agents to analyze a company's stock"
    )

    team.addAgent(researchAgent);
    team.addAgent(researchEvaluator);
    team.addAgent(analystAgent);
    team.addAgent(writerAgent);
    
    console.log("Running stock analysis workflow with tools enabled...");

    const result = await team.run(
      "TSLA",
      {
        verbose: true,
        // enableConsoleStream: true,
        stream: true
      }
    )

    console.log(result);
    mcpBraveSearch.close();
    process.exit(0);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
