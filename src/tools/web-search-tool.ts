import axios from "axios";
import * as cheerio from "cheerio";
import type { ToolParameter } from "../types";
import { Tool } from "./tool";

/**
 * A tool for performing web searches using Searx
 *
 * Searx is a free, privacy-respecting metasearch engine with many public instances available.
 *
 * To use this tool, you need to:
 * 1. Find a public Searx instance (see https://searx.space for a list) or host your own
 * 2. Add the URL of the instance to your .env file as SEARX_INSTANCE_URL
 *    Example: SEARX_INSTANCE_URL=https://searx.be
 *
 * You can also set multiple instances by separating them with commas:
 *    Example: SEARX_INSTANCE_URL=https://searx.be,https://search.mdosch.de
 */
export class WebSearchTool extends Tool {
  // Store all configured Searx instances
  private searxInstances: string[] = [];
  // Track health status of instances
  private instanceStatus: Map<
    string,
    { failures: number; lastFailure: number }
  > = new Map();
  // Cache to store search results and prevent redundant requests
  private searchCache: Map<string, { results: any; timestamp: number }> =
    new Map();
  // Rate limiting settings
  private lastRequestTime = 0;
  private requestsInLastMinute = 0;
  private readonly MAX_REQUESTS_PER_MINUTE: number = 5; // Conservative limit to avoid bans
  private readonly CACHE_TTL_MS: number = 10 * 60 * 1000; // Cache results for 10 minutes
  // Cookie jar for persistent cookies
  private cookieJar: Map<string, string[]> = new Map();

  /**
   * Creates a new web search tool using Searx
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
      "Search the web for information using Searx",
      parameters,
      "Returns search results with titles, snippets, and links. Links should be used to get the content of the page using the web page content tool."
    );

    // Get Searx instance URLs from environment variables
    const instancesStr = process.env.SEARX_INSTANCE_URL || "";
    if (instancesStr) {
      this.searxInstances = instancesStr
        .split(",")
        .map((url) => url.trim())
        .filter((url) => url.length > 0);
    }

    if (this.searxInstances.length === 0) {
      console.warn(
        "SEARX_INSTANCE_URL environment variable is not set or contains no valid URLs. " +
          "Please add a Searx instance URL to your .env file. " +
          "Find public instances at https://searx.space or host your own."
      );
    } else {
      console.log(
        `Configured with ${this.searxInstances.length} Searx instance(s)`
      );
    }
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

    // Validate Searx instances
    if (this.searxInstances.length === 0) {
      return {
        error: "Searx instance URL not configured",
        errorDetails:
          "Please set SEARX_INSTANCE_URL in your environment variables",
        query: query,
        totalResults: 0,
        results: [],
      };
    }

    // Generate a cache key
    const cacheKey = `${query}:${numResults}`;

    // Check cache first
    const cachedResult = this.searchCache.get(cacheKey);
    if (
      cachedResult &&
      Date.now() - cachedResult.timestamp < this.CACHE_TTL_MS
    ) {
      console.log(`Using cached results for query: ${query}`);
      return cachedResult.results;
    }

    try {
      // Apply rate limiting with exponential backoff
      await this.applyRateLimit();

      const result = await this.searxSearch(query, numResults);

      // Cache the result
      this.searchCache.set(cacheKey, {
        results: result,
        timestamp: Date.now(),
      });

      // Clean up old cache entries
      this.cleanupCache();

      return result;
    } catch (error) {
      console.error("Error in Searx search:", error);

      // If we have a cached result, even if expired, return it as fallback
      if (cachedResult) {
        console.log(`Falling back to cached results for query: ${query}`);
        return {
          ...cachedResult.results,
          warning: "Search failed, showing cached results",
        };
      }

      return {
        error: "Failed to retrieve search results",
        errorDetails: error instanceof Error ? error.message : String(error),
        query: query,
        totalResults: 0,
        results: [],
      };
    }
  }

  /**
   * Apply rate limiting to prevent too many requests to Searx instances
   * Uses exponential backoff for retries when approaching limits
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Reset counter if a minute has passed
    if (timeSinceLastRequest > 60000) {
      this.requestsInLastMinute = 0;
    }

    // If we're approaching the rate limit, wait with exponential backoff
    if (this.requestsInLastMinute >= this.MAX_REQUESTS_PER_MINUTE) {
      const backoffTime = Math.min(
        30000, // Max 30 seconds
        2 ** (this.requestsInLastMinute - this.MAX_REQUESTS_PER_MINUTE) * 1000
      );

      console.log(
        `Rate limit approached. Waiting ${backoffTime}ms before next request`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffTime));

      // Reset counter after waiting
      this.requestsInLastMinute = 0;
    }

    // Ensure at least 2 seconds between requests to be polite to the server
    const minTimeBetweenRequests = 2000; // 2 seconds
    if (timeSinceLastRequest < minTimeBetweenRequests) {
      await new Promise((resolve) =>
        setTimeout(resolve, minTimeBetweenRequests - timeSinceLastRequest)
      );
    }

    // Update last request time and increment counter
    this.lastRequestTime = Date.now();
    this.requestsInLastMinute++;
  }

  /**
   * Clean up old cache entries to prevent memory leaks
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.searchCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL_MS) {
        this.searchCache.delete(key);
      }
    }
  }

  /**
   * Gets a healthy Searx instance from the available instances
   * @returns A Searx instance URL
   */
  private getHealthyInstance(): string {
    // Filter out instances with recent failures
    const now = Date.now();
    const healthyInstances = this.searxInstances.filter((instance) => {
      const status = this.instanceStatus.get(instance);
      if (!status) return true;

      // If the instance has failed multiple times recently, skip it
      if (status.failures > 3 && now - status.lastFailure < 30 * 60 * 1000) {
        return false;
      }
      return true;
    });

    // If no healthy instances, reset all and try again
    if (healthyInstances.length === 0) {
      console.log(
        "No healthy instances available, resetting all instance statuses"
      );
      this.instanceStatus.clear();
      return this.searxInstances[
        Math.floor(Math.random() * this.searxInstances.length)
      ];
    }

    // Return a random healthy instance
    return healthyInstances[
      Math.floor(Math.random() * healthyInstances.length)
    ];
  }

  /**
   * Mark an instance as failed
   * @param instance The instance URL that failed
   */
  private markInstanceFailed(instance: string): void {
    const status = this.instanceStatus.get(instance) || {
      failures: 0,
      lastFailure: 0,
    };
    status.failures++;
    status.lastFailure = Date.now();
    this.instanceStatus.set(instance, status);
    console.log(
      `Marked instance ${instance} as failed (failures: ${status.failures})`
    );
  }

  /**
   * Store cookies for a specific instance
   * @param instance The instance URL
   * @param cookies Array of cookies
   */
  private storeCookies(instance: string, cookies: string[]): void {
    if (cookies && cookies.length > 0) {
      this.cookieJar.set(instance, cookies);
    }
  }

  /**
   * Get stored cookies for a specific instance
   * @param instance The instance URL
   * @returns Array of cookies or undefined
   */
  private getCookies(instance: string): string[] | undefined {
    return this.cookieJar.get(instance);
  }

  /**
   * Performs a Searx search
   * @param query Search query
   * @param numResults Number of results to return
   * @returns Search results
   */
  private async searxSearch(query: string, numResults: number): Promise<any> {
    // Get a healthy instance
    const instance = this.getHealthyInstance();

    try {
      console.log(`Searching Searx instance ${instance} for: ${query}`);

      // Ensure the Searx instance URL doesn't end with a slash
      const baseUrl = instance.endsWith("/") ? instance.slice(0, -1) : instance;

      // Rotate between different realistic user agents
      const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ];

      const randomUserAgent =
        userAgents[Math.floor(Math.random() * userAgents.length)];

      // Add browser-like headers
      const headers: Record<string, string> = {
        "User-Agent": randomUserAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: baseUrl,
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Cache-Control": "max-age=0",
      };

      // Add cookies if available
      const cookies = this.getCookies(instance);
      if (cookies && cookies.length > 0) {
        headers.Cookie = cookies.join("; ");
      }

      // First visit the main page to get cookies
      try {
        const mainPageResponse = await axios.get(baseUrl, {
          headers: headers,
          timeout: 10000,
          withCredentials: true,
        });

        // Store cookies from response
        if (mainPageResponse.headers["set-cookie"]) {
          this.storeCookies(instance, mainPageResponse.headers["set-cookie"]);
        }

        // Update headers with new cookies
        const updatedCookies = this.getCookies(instance);
        if (updatedCookies && updatedCookies.length > 0) {
          headers.Cookie = updatedCookies.join("; ");
        }
      } catch (error) {
        console.warn(`Failed to visit main page of ${instance}:`, error);
        // Continue anyway
      }

      // Add a small random delay to mimic human behavior
      const humanDelay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
      await new Promise((resolve) => setTimeout(resolve, humanDelay));

      // IMPORTANT: Request HTML format instead of JSON
      const response = await axios.get(`${baseUrl}/search`, {
        params: {
          q: query,
          // No format parameter - default to HTML
          pageno: 1,
          language: "en",
          time_range: "",
          safesearch: 0,
          categories: "general",
        },
        headers: headers,
        timeout: 15000, // 15 second timeout to prevent hanging requests
        withCredentials: true, // Maintain cookies between requests
      });

      // Store new cookies
      if (response.headers["set-cookie"]) {
        this.storeCookies(instance, response.headers["set-cookie"]);
      }

      // Parse HTML response using Cheerio
      const $ = cheerio.load(response.data);
      console.log("Searx HTML response received, parsing results");

      // Extract results from HTML
      const results = this.parseHtmlSearchResults(
        $,
        query,
        numResults,
        baseUrl
      );
      console.log(
        `Extracted ${results.length} results from Searx HTML response`
      );

      return {
        results,
        totalResults: results.length,
        source: "Searx",
      };
    } catch (error) {
      // Mark this instance as failed
      this.markInstanceFailed(instance);

      // Handle specific error types differently
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // Handle HTTP errors (e.g., 429 Too Many Requests)
          if (error.response.status === 429) {
            throw new Error(
              `Searx instance ${instance} rate limit exceeded. Try again later.`
            );
          }

          throw new Error(
            `Searx server error: ${error.response.status} ${error.response.statusText}`
          );
        }

        if (error.code === "ECONNABORTED") {
          throw new Error(
            `Searx search on ${instance} timed out. The server might be overloaded.`
          );
        }
      }

      console.error(`Error in Searx search on ${instance}:`, error);

      // If we have multiple instances, try another one
      if (this.searxInstances.length > 1) {
        console.log("Trying another Searx instance...");
        return this.searxSearch(query, numResults);
      }

      throw error;
    }
  }

  /**
   * Parses search results from Searx HTML response
   * @param $ Cheerio instance loaded with HTML
   * @param query Original search query
   * @param numResults Maximum number of results to extract
   * @param baseUrl The base URL of the Searx instance
   * @returns Formatted search results
   */
  private parseHtmlSearchResults(
    $: cheerio.CheerioAPI,
    query: string,
    numResults: number,
    baseUrl: string
  ): any[] {
    const results: any[] = [];

    // Updated selectors for SearXNG results
    const resultSelectors = [
      "article.result", // Main SearXNG result selector
      "article.result-default",
      ".result",
      ".searchresult",
      ".search-result",
      "#urls article", // SearXNG results container > article
      ".snippet",
      "#main .result",
    ];

    // Find the first selector that works
    let resultElements: cheerio.Cheerio<any> | null = null;
    for (const selector of resultSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        resultElements = elements;
        console.log(
          `Found ${elements.length} results using selector: ${selector}`
        );
        break;
      }
    }

    // If we couldn't find results with any selector
    if (!resultElements || resultElements.length === 0) {
      console.log("Could not find search results with any known selector");

      // As a fallback, try to extract links that might be results
      const possibleResults = $("a").filter((_i, el): boolean => {
        const href = $(el).attr("href");
        // Filter out links that are likely not search results
        return !!(
          href?.startsWith("http") &&
          !href.startsWith(baseUrl) &&
          !href.includes("settings") &&
          !href.includes("about") &&
          !href.includes("preferences")
        );
      });

      if (possibleResults.length > 0) {
        console.log(
          `Found ${possibleResults.length} possible result links as fallback`
        );

        possibleResults.each((_i, el) => {
          if (results.length >= numResults) return false;

          const $link = $(el);
          const title = $link.text().trim() || "Unknown Title";
          const link = $link.attr("href") || "";

          if (link?.startsWith("http")) {
            results.push({
              title,
              link,
              snippet: `Result found for query: ${query}`,
              source: "Searx (fallback extraction)",
            });
          }
        });
      }

      return results;
    }

    // Process each search result
    resultElements.each((_i, el) => {
      if (results.length >= numResults) return false;

      const $result = $(el);

      // Updated selectors for SearXNG result components
      const titleEl = $result.find("h3 a").first();
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";

      // Extract snippet from content paragraph
      const snippet = $result.find("p.content").text().trim();

      // Extract source from engines div
      const source = $result.find(".engines span").text().trim() || "Searx";

      // Only add if we have at least a title and link
      if (title && link) {
        results.push({
          title,
          link,
          snippet: snippet || `Result for query: ${query}`,
          source,
        });
      }
    });

    // SearXNG doesn't typically have separate infoboxes in the same way
    // But check for possible infoboxes or special features if present
    const infoboxSelectors = [".infobox", ".info-box", ".card"];

    for (const selector of infoboxSelectors) {
      if (results.length >= numResults) break;

      $(selector).each((_i, el) => {
        if (results.length >= numResults) return false;

        const $infobox = $(el);
        const title =
          $infobox.find("h3, h4, .title").first().text().trim() ||
          `Information about ${query}`;
        const content = $infobox.find(".content, p").text().trim();

        if (content) {
          results.push({
            title,
            link: `${baseUrl}?q=${encodeURIComponent(query)}`,
            snippet: content,
            source: "Searx Infobox",
          });
        }
      });
    }

    // Check for "no results" message
    if (results.length === 0) {
      const noResultsMsg = $(".no-results").text().trim();
      if (noResultsMsg) {
        console.log(`No results found: ${noResultsMsg}`);
      }
    }

    return results;
  }
}
