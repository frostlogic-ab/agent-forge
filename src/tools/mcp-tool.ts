import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolParameter } from "../types";
import { RateLimiter } from "../utils/rate-limiter";
import { Tool } from "./tool";

/**
 * Represents an MCP server protocol type
 */
export enum MCPProtocolType {
  STDIO = "stdio",
  SSE = "sse",
  STREAMABLE_HTTP = "streamable_http",
}

/**
 * Configuration for STDIO MCP server
 */
export interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  verbose?: boolean;
}

/**
 * Configuration for SSE MCP server
 */
export interface MCPSseConfig {
  url: string;
  headers?: Record<string, string>;
  verbose?: boolean;
}

/**
 * Configuration for Streamable HTTP MCP server
 */
export interface MCPStreamableHttpConfig {
  baseUrl: string | URL;
  headers?: Record<string, string>;
  verbose?: boolean;
  timeout?: number;
}

/**
 * Represents a tool definition from an MCP server
 */
export interface MCPTool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  returnType?: string;
}

/**
 * Base class for MCP client wrappers
 */
export abstract class MCPClientWrapper {
  protected running = false;

  /**
   * Initializes the MCP client
   */
  abstract initialize(): Promise<void>;

  /**
   * Lists available tools from the MCP server
   */
  abstract listTools(): Promise<MCPTool[]>;

  /**
   * Calls a tool on the MCP server
   * @param toolName Name of the tool to call
   * @param params Parameters to pass to the tool
   * @returns Result of the tool call
   */
  abstract callTool(
    toolName: string,
    params: Record<string, any>
  ): Promise<any>;

  /**
   * Closes the MCP client connection
   */
  abstract close(): Promise<void>;
}

/**
 * Implementation of MCPClientWrapper using the official SDK
 */
export class MCPSdkClientWrapper extends MCPClientWrapper {
  private client: MCPClient | null = null;
  private transport: any = null;
  private config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig;
  private type: MCPProtocolType;
  private cachedTools: MCPTool[] | null = null;
  private verbose: boolean;

  /**
   * Creates a new MCP SDK client wrapper
   * @param type Type of MCP server protocol
   * @param config Configuration for the MCP server
   */
  constructor(
    type: MCPProtocolType,
    config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig
  ) {
    super();
    this.config = config;
    this.type = type;
    this.verbose =
      (type === MCPProtocolType.SSE && (config as MCPSseConfig).verbose) ||
      (type === MCPProtocolType.STREAMABLE_HTTP &&
        (config as MCPStreamableHttpConfig).verbose) ||
      (type === MCPProtocolType.STDIO && (config as MCPStdioConfig).verbose) ||
      false;
  }

  /**
   * Creates the appropriate transport for the MCP client
   * @private
   */
  private createTransport(): any {
    switch (this.type) {
      case MCPProtocolType.STDIO: {
        const stdioConfig = this.config as MCPStdioConfig;
        if (this.verbose) {
          console.log(
            `Creating STDIO transport with command: ${stdioConfig.command} ${stdioConfig.args?.join(" ") || ""}`
          );
        }
        return new StdioClientTransport({
          command: stdioConfig.command,
          args: stdioConfig.args || [],
          env: stdioConfig.env,
        });
      }
      case MCPProtocolType.SSE: {
        const sseConfig = this.config as MCPSseConfig;
        if (this.verbose) {
          console.log(`Creating SSE transport with URL: ${sseConfig.url}`);
        }
        const url = new URL(sseConfig.url);
        return new SSEClientTransport(url);
      }
      case MCPProtocolType.STREAMABLE_HTTP: {
        const httpConfig = this.config as MCPStreamableHttpConfig;
        if (this.verbose) {
          console.log(
            `Creating Streamable HTTP transport with URL: ${httpConfig.baseUrl.toString()}`
          );
        }
        return new StreamableHTTPClientTransport(
          typeof httpConfig.baseUrl === "string"
            ? new URL(httpConfig.baseUrl)
            : httpConfig.baseUrl
        );
      }
      default:
        throw new Error(`Unsupported MCP protocol type: ${this.type}`);
    }
  }

  /**
   * Initializes the MCP client
   */
  async initialize(): Promise<void> {
    if (this.running) {
      return;
    }

    try {
      this.client = new MCPClient({
        name: "agent-forge-client",
        version: "1.0.0",
      });

      // Create transport
      this.transport = this.createTransport();

      // Connect to the MCP server
      if (this.verbose) {
        console.log("Connecting to MCP server...");
      }
      await this.client.connect(this.transport);
      this.running = true;
      if (this.verbose) {
        console.log("Connected to MCP server successfully");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize MCP client: ${errorMessage}`);
    }
  }

  /**
   * Extract tool parameters from various formats
   * @private
   */
  private extractParameters(tool: any): ToolParameter[] {
    const parameters: ToolParameter[] = [];

    // Handle standard array format
    if (Array.isArray(tool.parameters)) {
      for (const param of tool.parameters) {
        parameters.push({
          name: param.name || "",
          description: param.description || "",
          type: param.type || "string",
          required: param.required || false,
        });
      }
      return parameters;
    }

    // Handle JSON Schema in parameters
    if (tool.parameters?.properties) {
      const schema = tool.parameters;
      this.extractSchemaParameters(schema, parameters);
      return parameters;
    }

    // Handle JSON Schema in inputSchema
    if (tool.inputSchema?.properties) {
      const schema = tool.inputSchema;
      this.extractSchemaParameters(schema, parameters);
      return parameters;
    }

    return parameters;
  }

  /**
   * Extract parameters from a JSON schema
   * @private
   */
  private extractSchemaParameters(
    schema: any,
    parameters: ToolParameter[]
  ): void {
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const prop = propSchema as any;
      parameters.push({
        name,
        description: prop.description || "",
        type: prop.type || "string",
        required: schema.required?.includes(name) || false,
      });
    }
  }

  /**
   * Extract tools array from response
   * @private
   */
  private extractToolsArray(toolsResponse: any): any[] {
    if (Array.isArray(toolsResponse)) {
      return toolsResponse;
    }

    if (toolsResponse?.tools && Array.isArray(toolsResponse.tools)) {
      return toolsResponse.tools;
    }

    return [];
  }

  /**
   * Process tools into MCPTool format
   * @private
   */
  private processTools(toolsArray: any[]): MCPTool[] {
    const tools: MCPTool[] = [];

    for (const tool of toolsArray) {
      const parameters = this.extractParameters(tool);

      tools.push({
        name: tool.name || "",
        description: tool.description || "",
        parameters,
        returnType: undefined,
      });
    }

    return tools;
  }

  /**
   * Lists available tools from the MCP server
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.running) {
      await this.initialize();
    }

    if (this.cachedTools) {
      return this.cachedTools;
    }

    if (!this.client) {
      throw new Error("MCP client not initialized");
    }

    try {
      if (this.verbose) {
        console.log("Requesting tools from MCP server...");
      }

      const toolsResponse = await this.client.listTools();

      if (this.verbose) {
        console.log(
          "Raw tools response:",
          JSON.stringify(toolsResponse, null, 2)
        );
      }

      const toolsArray = this.extractToolsArray(toolsResponse);

      if (this.verbose) {
        console.log(`Received ${toolsArray.length || 0} tools from MCP server`);
      }

      const tools = this.processTools(toolsArray);

      if (this.verbose) {
        console.log(`Processed ${tools.length} tools from MCP server`);
        if (tools.length > 0) {
          console.log("Tool names:", tools.map((t) => t.name).join(", "));
        }
      }

      this.cachedTools = tools;
      return tools;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list MCP tools: ${errorMessage}`);
    }
  }

  /**
   * Calls a tool on the MCP server
   * @param toolName Name of the tool to call
   * @param params Parameters to pass to the tool
   * @returns Result of the tool call
   */
  async callTool(toolName: string, params: Record<string, any>): Promise<any> {
    if (!this.running) {
      await this.initialize();
    }

    if (!this.client) {
      throw new Error("MCP client not initialized");
    }

    try {
      if (this.verbose) {
        console.log(`Calling MCP tool: ${toolName}`);
        console.log("Parameters:", params);
      }

      // Call the tool using the SDK client
      const result = await this.client.callTool({
        name: toolName,
        arguments: params,
      });

      if (this.verbose) {
        console.log(`MCP tool ${toolName} call successful`);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to call MCP tool ${toolName}: ${errorMessage}`);
    }
  }

  /**
   * Closes the MCP client connection
   */
  async close(): Promise<void> {
    if (this.running && this.client && this.transport) {
      if (this.verbose) {
        console.log("Closing MCP client connection");
      }

      // The SDK handles proper cleanup
      try {
        await this.transport.close();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error closing MCP client: ${errorMessage}`);
      }

      this.running = false;
      this.client = null;
      this.transport = null;
      this.cachedTools = null;
    }
  }
}

/**
 * A Tool implementation that wraps an MCP server tool
 */
export class MCPToolWrapper extends Tool {
  private mcpClient: MCPClientWrapper;
  private mcpToolName: string;
  private rateLimiter?: RateLimiter;
  private cache = new Map<string, { result: any; timestamp: number }>();
  private cacheTTL = 60000; // 1 minute cache TTL by default

  /**
   * Creates a new MCP tool wrapper
   * @param mcpTool Tool definition from the MCP server
   * @param mcpClient Connection to the MCP server
   * @param rateLimiter Optional rate limiter for API calls
   * @param options Optional configuration for the tool wrapper
   */
  constructor(
    mcpTool: MCPTool,
    mcpClient: MCPClientWrapper,
    rateLimiter?: RateLimiter,
    options?: { cacheTTL?: number }
  ) {
    super(
      mcpTool.name,
      mcpTool.description,
      mcpTool.parameters,
      mcpTool.returnType
    );

    this.mcpClient = mcpClient;
    this.mcpToolName = mcpTool.name;
    this.rateLimiter = rateLimiter;

    if (options?.cacheTTL) {
      this.cacheTTL = options.cacheTTL;
    }
  }

  /**
   * Runs the MCP tool
   * @param params Parameters for the tool
   * @returns Result of the tool execution
   */
  protected async run(params: Record<string, any>): Promise<any> {
    // Generate a cache key from the tool name and params
    const cacheKey = this.getCacheKey(params);

    // Check if we have a cached result
    const cachedResult = this.checkCache(cacheKey);
    if (cachedResult) {
      if (this.rateLimiter?.options.verbose) {
        console.log(`Cache hit for ${this.mcpToolName}`);
      }
      return cachedResult;
    }

    // Apply rate limiting if configured
    if (this.rateLimiter) {
      await this.rateLimiter.waitForToken();
    }

    // Implement exponential backoff for retries
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= maxRetries) {
      try {
        const result = await this.mcpClient.callTool(this.mcpToolName, params);

        // Process the result if it's a JSON string inside a content array
        if (result?.content && Array.isArray(result.content)) {
          // Check if we have text content that's actually JSON
          for (let i = 0; i < result.content.length; i++) {
            const item = result.content[i];
            if (item.type === "text") {
              // If it's already a string, keep it as is
              if (typeof item.text === "string") {
                try {
                  // Try to parse the JSON string
                  const parsed = JSON.parse(item.text);
                  // Format the parsed object as plain text
                  result.content[i].text = this.formatObjectAsText(parsed);
                } catch {
                  // Not valid JSON, leave as is
                }
              }
              // If it's already an object, format it as text
              else if (typeof item.text === "object" && item.text !== null) {
                result.content[i].text = this.formatObjectAsText(item.text);
              }
            }
          }
        }

        // Cache the successful result
        this.cacheResult(cacheKey, result);

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if it's a rate limit error
        const isRateLimitError =
          lastError.message.includes("Rate limit") ||
          lastError.message.includes("429") ||
          lastError.message.includes("Too Many Requests");

        // Only retry rate limit errors
        if (isRateLimitError && retryCount < maxRetries) {
          retryCount++;
          const backoffTime = 2 ** retryCount * 1000; // Exponential backoff: 2s, 4s, 8s

          if (this.rateLimiter?.options.verbose) {
            console.log(
              `Rate limit hit for tool '${this.mcpToolName}'. Retry ${retryCount}/${maxRetries} after ${backoffTime / 1000}s backoff...`
            );
          }

          // Wait for the backoff period
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
          continue;
        }

        // For rate limit errors that we've exhausted retries for, provide enhanced error
        if (isRateLimitError) {
          const enhancedError = new Error(
            `Rate limit exceeded for tool '${this.mcpToolName}' after ${maxRetries} retries. Please try again later or reduce request frequency.`
          );
          throw enhancedError;
        }

        // Re-throw other errors immediately
        throw lastError;
      }
    }

    // This should never execute due to the throw inside the loop
    // but TypeScript might complain without it
    throw lastError;
  }

  /**
   * Generates a cache key from parameters
   */
  private getCacheKey(params: Record<string, any>): string {
    return `${this.mcpToolName}:${JSON.stringify(params)}`;
  }

  /**
   * Checks the cache for a valid entry
   */
  private checkCache(cacheKey: string): any | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    // Check if cache entry is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      // Expired cache entry
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.result;
  }

  /**
   * Caches a result
   */
  private cacheResult(cacheKey: string, result: any): void {
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Formats an object as readable text
   * @param obj Object to format
   * @returns Formatted text
   */
  private formatObjectAsText(obj: Record<string, any>): string {
    if (!obj) return "No data available";

    // Generic object formatting
    try {
      // For simple objects, create a formatted representation
      const entries = Object.entries(obj)
        .filter(([_, value]) => value !== null && value !== "")
        .map(([key, value]) => {
          if (typeof value === "object" && value !== null) {
            // For nested objects, use JSON.stringify with formatting
            return `${key}: ${JSON.stringify(value, null, 2)}`;
          }
          return `${key}: ${value}`;
        });

      if (entries.length > 0) {
        return entries.join("\n");
      }
    } catch {
      // If there are any issues formatting, fall back to basic JSON
      try {
        return JSON.stringify(obj, null, 2);
      } catch {
        return "Error formatting object data";
      }
    }

    return "Empty object";
  }
}

/**
 * Creates an MCP client wrapper based on configuration
 * @param type Type of MCP server protocol
 * @param config Configuration for the MCP server
 * @returns An MCP client wrapper
 */
export function createMCPClient(
  type: MCPProtocolType,
  config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig
): MCPClientWrapper {
  return new MCPSdkClientWrapper(type, config);
}

/**
 * Manager for MCP client connections and tools
 */
export class MCPManager {
  private clients: MCPClientWrapper[] = [];
  private tools: MCPToolWrapper[] = [];
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private globalRateLimiter?: RateLimiter;

  /**
   * Creates a new MCP Manager
   * @param options Options for the MCP manager, including rate limiting
   */
  constructor(options?: {
    rateLimitPerMinute?: number;
    rateLimitPerSecond?: number;
    toolSpecificLimits?: {
      [toolNamePattern: string]: {
        rateLimitPerSecond?: number;
        rateLimitPerMinute?: number;
      };
    };
    verbose?: boolean;
  }) {
    // Create global rate limiter if specified
    if (options?.rateLimitPerSecond || options?.rateLimitPerMinute) {
      this.globalRateLimiter = new RateLimiter({
        callsPerSecond: options.rateLimitPerSecond,
        callsPerMinute: options.rateLimitPerMinute,
        verbose: options.verbose,
        toolName: "global",
      });

      if (options.verbose) {
        const rateStr = options.rateLimitPerSecond
          ? `${options.rateLimitPerSecond} calls per second`
          : `${options.rateLimitPerMinute} calls per minute`;
        console.log(
          `MCP Manager initialized with global rate limit of ${rateStr}`
        );
      }
    }

    // Create tool-specific rate limiters if specified
    if (options?.toolSpecificLimits) {
      for (const [pattern, limits] of Object.entries(
        options.toolSpecificLimits
      )) {
        const rateLimiter = new RateLimiter({
          callsPerSecond: limits.rateLimitPerSecond,
          callsPerMinute: limits.rateLimitPerMinute,
          verbose: options.verbose,
          toolName: pattern,
        });

        this.rateLimiters.set(pattern, rateLimiter);

        if (options.verbose) {
          const rateStr = limits.rateLimitPerSecond
            ? `${limits.rateLimitPerSecond} calls per second`
            : `${limits.rateLimitPerMinute} calls per minute`;
          console.log(
            `Tool-specific rate limiter created for '${pattern}': ${rateStr}`
          );
        }
      }
    }
  }

  /**
   * Adds an MCP client connection
   * @param client MCP client wrapper to add
   */
  async addClient(client: MCPClientWrapper): Promise<void> {
    await client.initialize();

    // Get tools from the client
    const mcpTools = await client.listTools();

    // Create wrappers for each tool
    for (const mcpTool of mcpTools) {
      // Determine which rate limiter to use
      let rateLimiter = this.globalRateLimiter;

      // Check if there's a tool-specific rate limiter that matches
      for (const [pattern, specificLimiter] of this.rateLimiters.entries()) {
        if (mcpTool.name.includes(pattern)) {
          rateLimiter = specificLimiter;
          break;
        }
      }

      const wrapper = new MCPToolWrapper(mcpTool, client, rateLimiter);
      this.tools.push(wrapper);
    }

    this.clients.push(client);
  }

  /**
   * Gets all MCP tools as Tool instances
   * @returns Array of MCP tool wrappers
   */
  getTools(): Tool[] {
    return this.tools;
  }

  /**
   * Closes all MCP connections
   */
  async close(): Promise<void> {
    for (const client of this.clients) {
      await client.close();
    }

    this.clients = [];
    this.tools = [];
  }
}
