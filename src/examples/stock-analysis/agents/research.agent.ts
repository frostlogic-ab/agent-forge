import { agent } from "../../../core/decorators";
import { Agent } from "../../../core/agent";
import { llmProvider } from "../../../core/decorators";
import { MCP } from "../../../tools/decorators";
import { configuredProvider, configuredApiKey, configuredModel } from "../provider";
import { MCPProtocolType } from "../../../tools/mcp-tool";
import { RateLimiter } from "../../../utils/decorators";

@RateLimiter({
  rateLimitPerSecond: 1,
  toolSpecificLimits: {
    'brave': {
      rateLimitPerSecond: 1
    }
  },
  verbose: true,
})
@MCP(MCPProtocolType.STDIO, {
    command: "docker",
    args: ["run", "-i", "--rm", "-e", "BRAVE_API_KEY", "mcp/brave-search"],
    env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
    },
    verbose: true,
})
@llmProvider(configuredProvider, {apiKey: configuredApiKey})
@agent({
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

    Do all searches at the same time.
    
    ### Data extraction
    Extract the most relevant information about:
    - Current stock price and recent movement
    - Latest earnings report data
    - Any significant recent news with correct citations
    
    ### Guidelines
    Be smart and concise. Keep responses as detailed as possible and focused on facts.`,
    model: configuredModel,
    temperature: 0.1,
})
export class ResearchAgent extends Agent {}