import axios from "axios";
import type { ToolParameter } from "../types";
import { Tool } from "./tool";

/**
 * A tool for performing web searches using DuckDuckGo
 */
export class WebSearchTool extends Tool {
  /**
   * Creates a new web search tool using DuckDuckGo
   */
  constructor() {
    // Define parameters
    const parameters: ToolParameter[] = [
      {
        name: "query",
        type: "string",
        description: "The search query",
        required: true,
      },
      {
        name: "numResults",
        type: "number",
        description: "Number of results to return",
        required: false,
        default: 5,
      },
    ];

    super(
      "WebSearch",
      "Search the web for information using DuckDuckGo",
      parameters,
      "Returns search results with titles, snippets, and links"
    );
  }

  /**
   * Executes a web search
   * @param params Search parameters
   * @returns Search results
   */
  protected async run(params: {
    query: string;
    numResults?: number;
  }): Promise<any> {
    const { query, numResults = 5 } = params;

    try {
      return await this.duckDuckGoSearch(query, numResults);
    } catch (error) {
      console.error("Error in DuckDuckGo search:", error);
      return this.mockSearch(query, numResults); // Fall back to mock search on error
    }
  }

  /**
   * Performs a DuckDuckGo search
   * @param query Search query
   * @param numResults Number of results to return
   * @returns Search results
   */
  private async duckDuckGoSearch(
    query: string,
    numResults: number
  ): Promise<any> {
    try {
      // DuckDuckGo API endpoint
      const response = await axios.get("https://api.duckduckgo.com/", {
        params: {
          q: query,
          format: "json",
          no_html: 1,
          skip_disambig: 1,
        },
      });

      const data = response.data;
      const results = this.extractSearchResults(data, query, numResults);

      return {
        results,
        totalResults: results.length,
        source: "DuckDuckGo",
      };
    } catch (error) {
      console.error("Error in DuckDuckGo search:", error);
      throw error; // Re-throw to be caught by the run method
    }
  }

  /**
   * Extracts and formats search results from DuckDuckGo response
   * @param data DuckDuckGo response data
   * @param query Original search query
   * @param numResults Maximum number of results to extract
   * @returns Formatted search results
   */
  private extractSearchResults(
    data: any,
    query: string,
    numResults: number
  ): any[] {
    const results: any[] = [];

    // Add abstract if available
    this.addAbstractResult(results, data, query);

    // Add related topics if available and needed
    this.addRelatedTopics(results, data, numResults);

    // Add results if available and needed
    this.addResults(results, data, numResults);

    return results.slice(0, numResults);
  }

  /**
   * Adds abstract result if available
   */
  private addAbstractResult(results: any[], data: any, query: string): void {
    if (data.Abstract) {
      results.push({
        title: data.Heading || "Abstract",
        link:
          data.AbstractURL ||
          `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: data.Abstract,
      });
    }
  }

  /**
   * Adds related topics to results
   */
  private addRelatedTopics(
    results: any[],
    data: any,
    maxResults: number
  ): void {
    if (!data.RelatedTopics?.length) return;

    const validTopics = data.RelatedTopics.filter(
      (topic: any) => topic.Text && !topic.Name
    );

    const remainingSlots = maxResults - results.length;
    const topicsToAdd = Math.min(validTopics.length, remainingSlots);

    for (let i = 0; i < topicsToAdd; i++) {
      const topic = validTopics[i];
      results.push({
        title: this.extractTitle(topic.FirstURL, topic.Text),
        link: topic.FirstURL,
        snippet: topic.Text,
      });
    }
  }

  /**
   * Adds results if available
   */
  private addResults(results: any[], data: any, maxResults: number): void {
    if (!data.Results?.length) return;

    const remainingSlots = maxResults - results.length;
    const resultsToAdd = Math.min(data.Results.length, remainingSlots);

    for (let i = 0; i < resultsToAdd; i++) {
      const result = data.Results[i];
      results.push({
        title: this.extractTitle(result.FirstURL, result.Text),
        link: result.FirstURL,
        snippet: result.Text,
      });
    }
  }

  /**
   * Extracts a title from URL or text
   */
  private extractTitle(url: string, text: string): string {
    if (!url) return text.substring(0, 50);
    try {
      return url.split("/").pop() || text.substring(0, 50);
    } catch {
      return text.substring(0, 50);
    }
  }

  /**
   * Provides mock search results for demonstration purposes
   * @param query Search query
   * @param numResults Number of results to return
   * @returns Mock search results
   */
  private mockSearch(query: string, numResults: number): any {
    // biome-ignore lint/suspicious/noConsoleLog: Mock search results
    console.log(`[Mock Search] Searching for: ${query}`);

    // Generate some mock results based on the query
    const results = [];

    for (let i = 1; i <= numResults; i++) {
      results.push({
        title: `Result ${i} for "${query}"`,
        link: `https://example.com/result-${i}`,
        snippet: `This is a mock search result ${i} for the query "${query}". In a real implementation, this would contain actual content from the web.`,
      });
    }

    return {
      results,
      totalResults: numResults,
      note: "These are mock search results. DuckDuckGo search API is currently unavailable.",
    };
  }
}
