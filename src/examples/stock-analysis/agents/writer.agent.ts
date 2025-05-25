import { Agent } from "../../../core/agent";
import { agent, llmProvider } from "../../../core/decorators";
import { configuredProvider, configuredApiKey, configuredModel } from "../provider";

@llmProvider(configuredProvider, {apiKey: configuredApiKey})
@agent({
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
    model: configuredModel,
    temperature: 0.4
  })
export class WriterAgent extends Agent {}