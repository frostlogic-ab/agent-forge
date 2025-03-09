import axios from "axios";
import * as cheerio from "cheerio";
import type { ToolParameter } from "../types";
import { Tool } from "./tool";

/**
 * A tool for fetching and extracting the text content of a webpage.
 *
 * This tool can be used to:
 * 1. Retrieve the full HTML content of a webpage
 * 2. Extract the main text content from the page
 * 3. Clean and format the text for better readability
 *
 * It handles common issues like handling HTTP errors, following redirects,
 * and removing irrelevant content such as navigation, footers, ads, etc.
 */
export class WebPageContentTool extends Tool {
  // Cache to store fetched content to avoid redundant requests
  private contentCache: Map<string, { content: string; timestamp: number }> =
    new Map();
  // Rate limiting settings
  private lastRequestTime = 0;
  private requestsInLastMinute = 0;
  private readonly MAX_REQUESTS_PER_MINUTE = 10;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // Cache results for 10 minutes

  /**
   * Creates a new webpage content extraction tool
   */
  constructor() {
    // Define parameters
    const parameters: ToolParameter[] = [
      {
        name: "url",
        type: "string",
        description: "The URL of the webpage to extract content from",
        required: true,
      },
      {
        name: "extractMainContent",
        type: "boolean",
        description:
          "Whether to extract only the main content or return the full HTML",
        required: false,
        default: true,
      },
    ];

    super(
      "WebPageContent",
      "Extract the text content from a webpage. Use this tool to get the content of a webpage if you need to. Always use this tool if you find a URL in a query.",
      parameters,
      "Returns the text content of the specified webpage"
    );
  }

  /**
   * Fetches and extracts content from a webpage
   * @param params Parameters for the tool
   * @returns The extracted content
   */
  protected async run(params: {
    url: string;
    extractMainContent?: boolean;
  }): Promise<any> {
    console.log(
      `[WebPageContentTool] Fetching content from URL: ${params.url}`
    );

    const { url, extractMainContent = true } = params;

    try {
      // Validate URL
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        console.error(`[WebPageContentTool] Invalid URL format: ${url}`);
        return {
          url,
          error: "Invalid URL format. URL must start with http:// or https://",
          content: "Could not fetch content due to invalid URL format.",
        };
      }

      // Apply rate limiting
      await this.applyRateLimit();

      // Check cache first
      const cacheKey = `${url}:${extractMainContent}`;
      const cachedResult = this.getFromCache(cacheKey);
      if (cachedResult) {
        console.log(`[WebPageContentTool] Returning cached content for ${url}`);
        return {
          url,
          content: cachedResult,
          source: "cache",
        };
      }

      console.log(`[WebPageContentTool] Fetching live content from ${url}`);

      // Fetch the webpage content
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        timeout: 15000, // 15 second timeout
        maxRedirects: 5,
      });

      if (response.status !== 200) {
        console.error(`[WebPageContentTool] HTTP error: ${response.status}`);
        throw new Error(`Failed to fetch webpage: HTTP ${response.status}`);
      }

      // Check if we got any data
      if (!response.data) {
        console.error(`[WebPageContentTool] No data received from ${url}`);
        throw new Error("No data received from webpage");
      }

      console.log(
        `[WebPageContentTool] Successfully fetched ${url}, content length: ${response.data.length} bytes`
      );

      let content: string;

      if (extractMainContent) {
        // Parse the HTML and extract the main content
        content = this.extractContent(response.data, url);
        console.log(
          `[WebPageContentTool] Extracted content length: ${content.length} bytes`
        );
      } else {
        // Return the full HTML
        content = response.data;
        console.log(
          `[WebPageContentTool] Returning full HTML content: ${content.length} bytes`
        );
      }

      // Ensure we have some content
      if (!content || content.trim().length === 0) {
        console.warn(`[WebPageContentTool] No content extracted from ${url}`);
        content = "No content could be extracted from this webpage.";
      }

      // Truncate very large content to a reasonable size (30,000 chars)
      if (content.length > 30000) {
        console.log(
          `[WebPageContentTool] Truncating large content from ${content.length} to 30,000 characters`
        );
        content = `${content.substring(
          0,
          30000
        )}\n\n[Content truncated due to length...]`;
      }

      // Store in cache
      this.addToCache(cacheKey, content);

      return {
        url,
        content,
        source: "live",
      };
    } catch (error) {
      // Log detailed error information
      console.error(`[WebPageContentTool] Error fetching ${url}:`, error);

      let errorMessage =
        "Unknown error occurred while extracting webpage content";

      if (error instanceof Error) {
        errorMessage = `Failed to extract content from webpage: ${error.message}`;

        // Add more specific details for common errors
        if (axios.isAxiosError(error)) {
          if (error.code === "ECONNREFUSED") {
            errorMessage = `Could not connect to the website at ${url}. Connection refused.`;
          } else if (error.code === "ENOTFOUND") {
            errorMessage = `Could not resolve the website domain for ${url}. Domain not found.`;
          } else if (error.response) {
            errorMessage = `Website returned error: HTTP ${error.response.status} - ${error.response.statusText}`;
          } else if (error.request) {
            errorMessage =
              "No response received from the website. The request was made but no response was received.";
          }
        }
      }

      // Return a structured error response instead of throwing
      return {
        url,
        error: errorMessage,
        content: `Could not retrieve content from this webpage. ${errorMessage}`,
      };
    }
  }

  /**
   * Extract the main content from an HTML page
   * @param html The HTML content of the page
   * @param url The URL of the page
   * @returns The extracted text content
   */
  private extractContent(html: string, url: string): string {
    try {
      const $ = cheerio.load(html);

      // Remove scripts, styles, and other non-content elements
      $("script, style, nav, footer, header, iframe, noscript").remove();

      // Extract the title
      const title = $("title").text().trim() || "Untitled Page";
      console.log(`[WebPageContentTool] Page title: ${title}`);

      // Try to identify the main content
      let mainContent = "";

      // Try common content container selectors
      const contentSelectors = [
        "main",
        "article",
        "#content",
        ".content",
        ".post",
        ".article",
        ".post-content",
        "[role='main']",
        "#main-content",
        ".main-content",
      ];

      // Try each selector until we find content
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          console.log(
            `[WebPageContentTool] Found content with selector: ${selector}`
          );
          mainContent = this.cleanText(element.text());

          // If we found substantial content, break
          if (mainContent.length > 200) {
            break;
          }
        }
      }

      // If no main content found, extract from body with heuristics
      if (!mainContent || mainContent.length < 200) {
        console.log(
          "WebPageContentTool: No main content container found, extracting paragraphs"
        );

        // Extract paragraphs
        const paragraphs = $("p")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter((p) => p.length > 20) // Only keep paragraphs with substantial text
          .join("\n\n");

        if (paragraphs.length > mainContent.length) {
          mainContent = paragraphs;
        } else {
          // Last resort: get the body text
          console.log("WebPageContentTool: Falling back to body text");
          mainContent = this.cleanText($("body").text());
        }
      }

      if (!mainContent || mainContent.trim().length === 0) {
        console.warn(
          "WebPageContentTool: Failed to extract meaningful content"
        );
        return `# ${title}\n\nNo meaningful content could be extracted from this page.\n\nSource: ${url}`;
      }

      // Format the result
      return `# ${title}\n\n${mainContent}\n\nSource: ${url}`;
    } catch (error) {
      console.error("WebPageContentTool: Error extracting content:", error);
      return `Error extracting content: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  }

  /**
   * Clean and format extracted text
   * @param text The text to clean
   * @returns Cleaned text
   */
  private cleanText(text: string): string {
    if (!text) return "";

    return text
      .replace(/\s+/g, " ") // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, "\n\n") // Replace multiple newlines with double newline
      .replace(/\t/g, "") // Remove tabs
      .trim();
  }

  /**
   * Apply rate limiting to avoid overloading servers
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset counter if a minute has passed
    if (now - this.lastRequestTime > 60000) {
      this.requestsInLastMinute = 0;
      this.lastRequestTime = now;
    }

    // Check if we've hit the rate limit
    if (this.requestsInLastMinute >= this.MAX_REQUESTS_PER_MINUTE) {
      const timeToWait = 60000 - (now - this.lastRequestTime);
      console.log(
        `WebPageContentTool: Rate limit reached, waiting ${timeToWait}ms`
      );

      // Wait until we can make requests again
      await new Promise((resolve) => setTimeout(resolve, timeToWait));

      // Reset counter
      this.requestsInLastMinute = 0;
      this.lastRequestTime = Date.now();
    }

    // Increment request counter
    this.requestsInLastMinute++;
  }

  /**
   * Get content from cache if available and not expired
   * @param key Cache key
   * @returns Cached content or null if not found or expired
   */
  private getFromCache(key: string): string | null {
    const cached = this.contentCache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_TTL_MS) {
      this.contentCache.delete(key);
      return null;
    }

    return cached.content;
  }

  /**
   * Add content to cache
   * @param key Cache key
   * @param content Content to cache
   */
  private addToCache(key: string, content: string): void {
    // Clean up cache first
    this.cleanupCache();

    // Add new entry
    this.contentCache.set(key, {
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();

    for (const [key, entry] of this.contentCache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.contentCache.delete(key);
      }
    }

    // If cache is too large, remove oldest entries
    if (this.contentCache.size > 100) {
      const entries = Array.from(this.contentCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      // Remove oldest entries until we're back at 50 entries
      for (let i = 0; i < entries.length - 50; i++) {
        this.contentCache.delete(entries[i][0]);
      }
    }
  }
}
