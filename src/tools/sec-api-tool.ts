import axios from "axios";
import * as cheerio from "cheerio";
import type { ToolParameter } from "../types";
import { Tool } from "./tool";

/**
 * A tool for retrieving SEC filings (10-K and 10-Q) information
 */
export class SECApiTool extends Tool {
  private apiKey: string;

  /**
   * Creates a new SEC API tool
   */
  constructor() {
    // Define parameters
    const parameters: ToolParameter[] = [
      {
        name: "ticker",
        type: "string",
        description: "The stock ticker symbol (e.g., AAPL, MSFT, TSLA)",
        required: true,
      },
      {
        name: "formType",
        type: "string",
        description: "Type of SEC form to retrieve (10-K or 10-Q)",
        required: true,
      },
      {
        name: "searchQuery",
        type: "string",
        description: "Query to search within the SEC filing document",
        required: false,
      },
    ];

    super(
      "SECApi",
      "Retrieve and search SEC 10-K and 10-Q filings for publicly traded companies",
      parameters,
      "Returns the requested SEC filing data or search results"
    );

    // Get API key from environment variable
    this.apiKey = process.env.SEC_API_KEY || "";
    if (!this.apiKey) {
      console.warn("SEC_API_KEY environment variable is not set");
    }
  }

  /**
   * Executes the SEC API data retrieval
   * @param params Parameters for the data retrieval
   * @returns SEC filing data or search results
   */
  protected async run(params: {
    ticker: string;
    formType: string;
    searchQuery?: string;
  }): Promise<any> {
    const { ticker, formType, searchQuery } = params;
    const normalizedTicker = ticker.toUpperCase();
    const normalizedFormType = formType.toUpperCase();

    // Validate form type
    if (normalizedFormType !== "10-K" && normalizedFormType !== "10-Q") {
      throw new Error(
        `Invalid form type: ${formType}. Supported types: 10-K, 10-Q`
      );
    }

    try {
      // Get the filing content directly
      const filingContent = await this.getFilingContent(
        normalizedTicker,
        normalizedFormType
      );

      // If there's a search query, perform search
      if (searchQuery) {
        return this.searchInFiling(
          filingContent,
          searchQuery,
          normalizedTicker,
          normalizedFormType
        );
      }

      // Return metadata about the filing
      return {
        ticker: normalizedTicker,
        formType: normalizedFormType,
        contentLength: filingContent.length,
        contentPreview: `${filingContent.substring(0, 500)}...`,
      };
    } catch (error) {
      console.error(
        `Error retrieving SEC data for ${normalizedTicker}:`,
        error
      );

      return {
        error: `Failed to retrieve ${normalizedFormType} data for ${normalizedTicker}`,
        errorDetails: error instanceof Error ? error.message : String(error),
        ticker: normalizedTicker,
        formType: normalizedFormType,
      };
    }
  }

  /**
   * Fetches and processes the content of the most recent SEC filing
   * @param ticker Stock ticker symbol
   * @param formType Type of SEC form (10-K or 10-Q)
   * @returns Processed content of the filing
   */
  private async getFilingContent(
    ticker: string,
    formType: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("SEC_API_KEY environment variable is not set");
    }

    try {
      // Get the filing URL
      const filingUrl = await this.getFilingUrl(ticker, formType);

      // Fetch the content
      return await this.fetchFilingContent(filingUrl);
    } catch (error) {
      console.error(`Error getting filing content for ${ticker}:`, error);
      throw error;
    }
  }

  /**
   * Gets the URL for the most recent SEC filing of the specified type
   * @param ticker Stock ticker symbol
   * @param formType Type of SEC form (10-K or 10-Q)
   * @returns URL of the filing
   */
  private async getFilingUrl(
    ticker: string,
    formType: string
  ): Promise<string> {
    try {
      // SEC API endpoint for querying filings
      const endpoint = `https://api.sec-api.io?token=${this.apiKey}`;

      // Query structure as expected by the SEC API
      const queryData = {
        query: {
          query_string: {
            query: `ticker:${ticker} AND formType:"${formType}"`,
          },
        },
        from: "0",
        size: "1",
        sort: [{ filedAt: { order: "desc" } }],
      };

      // Make the request
      const response = await axios.post(endpoint, queryData, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Check if we got filings back
      if (!response.data?.filings || response.data.filings.length === 0) {
        throw new Error(`No ${formType} filings found for ${ticker}`);
      }

      // Return the URL to the filing details
      return response.data.filings[0].linkToFilingDetails;
    } catch (error) {
      console.error(
        `Error fetching ${formType} filing URL for ${ticker}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Fetches and processes the content of an SEC filing from its URL
   * @param url URL of the SEC filing
   * @returns Processed content of the filing
   */
  private async fetchFilingContent(url: string): Promise<string> {
    try {
      // Fetch the filing HTML content
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "agent-forge/1.0 (contact@agent-forge.com)",
          "Accept-Encoding": "gzip, deflate",
        },
      });

      // Use cheerio to parse HTML and extract text
      const $ = cheerio.load(response.data);
      let text = $("body").text();

      // Clean up text - remove excessive whitespace and non-alphanumeric characters
      text = text.replace(/\s+/g, " ").trim();
      text = text.replace(/[^a-zA-Z0-9$.,\s\n]/g, ""); // Allow some punctuation

      return text;
    } catch (error) {
      console.error("Error fetching filing content:", error);
      throw error;
    }
  }

  /**
   * Performs search within the filing content
   * @param content Filing content
   * @param query Search query
   * @param ticker Stock ticker
   * @param formType Form type
   * @returns Search results
   */
  private searchInFiling(
    content: string,
    query: string,
    ticker: string,
    formType: string
  ): any {
    // Simple keyword-based search (in a real implementation, this would be semantic search)
    const queryLower = query.toLowerCase();

    // Split content into paragraphs
    const paragraphs = content.split(/\n\s*\n/);

    // Find paragraphs containing the query
    const matchingParagraphs = paragraphs.filter((p) =>
      p.toLowerCase().includes(queryLower)
    );

    // Limit results and add context
    const results = matchingParagraphs.slice(0, 5).map((p) => {
      // Find position of query in paragraph
      const index = p.toLowerCase().indexOf(queryLower);

      // Get context around the match (100 chars before and after)
      const start = Math.max(0, index - 100);
      const end = Math.min(p.length, index + query.length + 100);

      return {
        excerpt: `...${p.substring(start, end)}...`,
        relevance: "high", // In a real implementation, this would be a score
      };
    });

    return {
      ticker,
      formType,
      query,
      results,
      totalMatches: matchingParagraphs.length,
    };
  }
}
