import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import axios, { AxiosResponse } from "axios";
import { EventSourcePolyfill } from "event-source-polyfill";
import type { ToolParameter } from "../types";
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
 * Base class for MCP server connections
 */
export abstract class MCPServerConnection {
  protected running = false;

  /**
   * Initializes the MCP server connection
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
   * Closes the MCP server connection
   */
  abstract close(): Promise<void>;
}

/**
 * STDIO MCP server connection implementation
 */
export class MCPStdioConnection extends MCPServerConnection {
  private config: MCPStdioConfig;
  private process: ChildProcessWithoutNullStreams | null = null;
  private cachedTools: MCPTool[] | null = null;

  /**
   * Creates a new MCP STDIO connection
   * @param config Configuration for the STDIO MCP server
   */
  constructor(config: MCPStdioConfig) {
    super();
    this.config = config;
  }

  /**
   * Initializes the MCP STDIO connection
   */
  async initialize(): Promise<void> {
    if (this.running) {
      return;
    }

    try {
      // Create a child process to communicate with the MCP server
      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Set up error handler
      this.process.on("error", (error) => {
        console.error(`MCP STDIO process error: ${error}`);
      });

      // Set up exit handler
      this.process.on("exit", (code) => {
        if (code !== 0) {
          console.error(`MCP STDIO process exited with code ${code}`);
        }
        this.running = false;
      });

      // Set up stderr handler
      this.process.stderr.on("data", (data) => {
        console.error(`MCP STDIO stderr: ${data.toString()}`);
      });

      this.running = true;

      // Wait for the process to start
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      throw new Error(`Failed to initialize MCP STDIO connection: ${error}`);
    }
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

    if (!this.process) {
      throw new Error("MCP STDIO process not initialized");
    }

    try {
      // Use a message exchange protocol to get tools from the server
      const message = JSON.stringify({ type: "list_tools" });

      // Write to stdin of the process
      this.process.stdin.write(`${message}\n`);

      // Read from stdout (simplified - in a real implementation, this would be more robust)
      const response = await new Promise<string>((resolve, reject) => {
        let data = "";

        const onData = (chunk: any) => {
          data += chunk.toString();
          if (data.includes("\n")) {
            if (this.process) {
              this.process.stdout.off("data", onData);
            }
            resolve(data.trim());
          }
        };

        if (this.process) {
          this.process.stdout.on("data", onData);
        }

        // Add timeout for safety
        setTimeout(() => {
          if (this.process) {
            this.process.stdout.off("data", onData);
          }
          reject(new Error("Timeout waiting for MCP server response"));
        }, 5000);
      });

      const tools = JSON.parse(response) as MCPTool[];
      this.cachedTools = tools;
      return tools;
    } catch (error) {
      throw new Error(`Failed to list MCP tools: ${error}`);
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

    if (!this.process) {
      throw new Error("MCP STDIO process not initialized");
    }

    try {
      // Use a message exchange protocol to call a tool on the server
      const message = JSON.stringify({
        type: "call_tool",
        tool: toolName,
        params,
      });

      // Write to stdin of the process
      this.process.stdin.write(`${message}\n`);

      // Read from stdout (simplified - in a real implementation, this would be more robust)
      const response = await new Promise<string>((resolve, reject) => {
        let data = "";

        const onData = (chunk: any) => {
          data += chunk.toString();
          if (data.includes("\n")) {
            if (this.process) {
              this.process.stdout.off("data", onData);
            }
            resolve(data.trim());
          }
        };

        if (this.process) {
          this.process.stdout.on("data", onData);
        }

        // Add timeout for safety
        setTimeout(() => {
          if (this.process) {
            this.process.stdout.off("data", onData);
          }
          reject(new Error("Timeout waiting for MCP server response"));
        }, 30000); // Longer timeout for tool calls
      });

      return JSON.parse(response);
    } catch (error) {
      throw new Error(`Failed to call MCP tool ${toolName}: ${error}`);
    }
  }

  /**
   * Closes the MCP server connection
   */
  async close(): Promise<void> {
    if (this.running && this.process) {
      // Send exit message if the protocol supports it
      try {
        this.process.stdin.write(`${JSON.stringify({ type: "exit" })}\n`);
        // Give it a moment to exit cleanly
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (_error) {
        // Ignore error on exit message
      }

      // Kill the process if it's still running
      if (this.running) {
        this.process.kill();
      }

      this.running = false;
      this.process = null;
      this.cachedTools = null;
    }
  }
}

/**
 * SSE MCP server connection implementation
 */
export class MCPSseConnection extends MCPServerConnection {
  private config: MCPSseConfig;
  private eventSource: EventSourcePolyfill | null = null;
  private cachedTools: MCPTool[] | null = null;
  private requestId = 0;
  private pendingRequests: Map<
    number,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  > = new Map();

  /**
   * Creates a new MCP SSE connection
   * @param config Configuration for the SSE MCP server
   */
  constructor(config: MCPSseConfig) {
    super();
    this.config = config;
  }

  /**
   * Initializes the MCP SSE connection
   */
  async initialize(): Promise<void> {
    if (this.running) {
      return;
    }

    try {
      // Create EventSource connection to the SSE server
      this.eventSource = new EventSourcePolyfill(this.config.url, {
        headers: this.config.headers,
      });

      // Set up event handlers
      this.eventSource.onopen = () => {
        this.running = true;
        if (this.config.verbose) {
          console.log("MCP SSE connection opened");
        }
      };

      this.eventSource.onerror = (event) => {
        this.running = false;
        console.error("MCP SSE connection error:", event);

        // Reject all pending requests
        for (const [, { reject }] of this.pendingRequests) {
          reject(new Error("SSE connection error"));
        }
        this.pendingRequests.clear();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.config.verbose) {
            console.log("MCP SSE message:", data);
          }
          if (data.id && this.pendingRequests.has(data.id)) {
            const pendingRequest = this.pendingRequests.get(data.id);
            if (pendingRequest) {
              const { resolve } = pendingRequest;
              this.pendingRequests.delete(data.id);
              resolve(data.result);
            }
          }
        } catch (error) {
          console.error("Error processing SSE message:", error);
        }
      };

      // Wait for the connection to establish
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout connecting to MCP SSE server"));
        }, 5000);

        if (this.eventSource) {
          const originalOnOpen = this.eventSource.onopen;
          this.eventSource.onopen = function (this: any) {
            clearTimeout(timeout);
            this.running = true;
            resolve();
            if (originalOnOpen) originalOnOpen.call(this, new Event("open"));
          }.bind(this);
        }
      });
    } catch (error) {
      throw new Error(`Failed to initialize MCP SSE connection: ${error}`);
    }
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

    try {
      const requestId = this.requestId++;

      // Create a promise that will be resolved when we get a response
      const responsePromise = new Promise<MCPTool[]>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });

        // Add timeout for safety
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(new Error("Timeout waiting for MCP server response"));
          }
        }, 5000);
      });

      // Send request for tool list
      const message = JSON.stringify({
        id: requestId,
        type: "list_tools",
      });

      // Implement actual HTTP request to the SSE server
      try {
        await axios.post(this.config.url, message, {
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
          },
        });
      } catch (error) {
        console.error(`Failed to send request to SSE server: ${error}`);
        throw new Error(`Communication with SSE server failed: ${error}`);
      }

      const tools = await responsePromise;
      if (this.config.verbose) {
        console.log("DiscoveredMCP tools:", tools);
      }
      this.cachedTools = tools;
      return tools;
    } catch (error) {
      throw new Error(`Failed to list MCP tools: ${error}`);
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

    try {
      const requestId = this.requestId++;

      // Create a promise that will be resolved when we get a response
      const responsePromise = new Promise<any>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });

        // Add timeout for safety
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(new Error("Timeout waiting for MCP server response"));
          }
        }, 30000); // Longer timeout for tool calls
      });

      // Send request to call tool
      const message = JSON.stringify({
        id: requestId,
        type: "call_tool",
        tool: toolName,
        params,
      });
      if (this.config.verbose) {
        console.log("Sending MCP tool call:", message);
      }
      // Implement actual HTTP request to the SSE server
      try {
        await axios.post(this.config.url, message, {
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
          },
        });
      } catch (error) {
        console.error(`Failed to send request to SSE server: ${error}`);
        throw new Error(`Communication with SSE server failed: ${error}`);
      }

      return await responsePromise;
    } catch (error) {
      throw new Error(`Failed to call MCP tool ${toolName}: ${error}`);
    }
  }

  /**
   * Closes the MCP server connection
   */
  async close(): Promise<void> {
    if (this.running && this.eventSource) {
      this.eventSource.close();
      this.running = false;
      this.eventSource = null;
      this.cachedTools = null;

      // Reject all pending requests
      for (const [, { reject }] of this.pendingRequests) {
        reject(new Error("SSE connection closed"));
      }
      this.pendingRequests.clear();
      if (this.config.verbose) {
        console.log("MCP SSE connection closed");
      }
    }
  }
}

/**
 * Streamable HTTP MCP server connection implementation
 */
export class MCPStreamableHttpConnection extends MCPServerConnection {
  private config: MCPStreamableHttpConfig;
  private baseUrl: URL;
  private cachedTools: MCPTool[] | null = null;
  private requestId = 0;
  private pendingRequests: Map<
    number,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  > = new Map();
  private sessionId: string | null = null;

  /**
   * Creates a new MCP Streamable HTTP connection
   * @param config Configuration for the Streamable HTTP MCP server
   */
  constructor(config: MCPStreamableHttpConfig) {
    super();
    this.config = config;
    this.baseUrl =
      config.baseUrl instanceof URL ? config.baseUrl : new URL(config.baseUrl);
  }

  /**
   * Initializes the MCP Streamable HTTP connection
   */
  async initialize(): Promise<void> {
    if (this.running) {
      return;
    }

    try {
      // Initialize a new session with the server
      const response = await axios.post(
        this.baseUrl.toString(),
        JSON.stringify({
          type: "initialize",
          clientInfo: {
            name: "mcp-streamable-http-client",
            version: "1.0.0",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
          },
          responseType: "stream",
          timeout: this.config.timeout || 30000,
        }
      );

      // Extract session ID from response headers or body as needed
      // This is implementation-specific - adjust based on server requirements
      this.sessionId =
        response.headers["x-mcp-session-id"] || this.generateSessionId();

      // Set up a streaming connection to handle server events
      this.setupStreamingConnection();

      this.running = true;

      if (this.config.verbose) {
        console.log(
          `MCP Streamable HTTP connection initialized with session ID: ${this.sessionId}`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize MCP Streamable HTTP connection: ${errorMessage}`
      );
    }
  }

  /**
   * Sets up the streaming connection to receive events from the server
   */
  private setupStreamingConnection(): void {
    const streamUrl = new URL(this.baseUrl);
    streamUrl.searchParams.append("sessionId", this.sessionId || "");

    // Setup the streaming connection using fetch API
    fetch(streamUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...this.config.headers,
      },
    })
      .then((response) => {
        if (!response.body) {
          throw new Error("No response body in stream");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Process the stream
        const processStream = async (): Promise<void> => {
          try {
            const { done, value } = await reader.read();

            if (done) {
              if (this.config.verbose) {
                console.log("MCP Streamable HTTP stream closed");
              }
              this.running = false;
              return;
            }

            // Decode the chunk and add it to our buffer
            buffer += decoder.decode(value, { stream: true });

            // Process any complete messages in the buffer
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || ""; // Keep the last incomplete chunk

            for (const line of lines) {
              if (line.trim()) {
                try {
                  // Parse each message and handle it
                  const message = JSON.parse(line);
                  this.handleStreamMessage(message);
                } catch (error) {
                  console.error("Error parsing stream message:", error);
                }
              }
            }

            // Continue processing the stream
            processStream();
          } catch (error) {
            console.error("Error reading stream:", error);
            this.running = false;

            // Reject all pending requests
            for (const [, { reject }] of this.pendingRequests) {
              reject(new Error("Stream connection error"));
            }
            this.pendingRequests.clear();
          }
        };

        // Start processing the stream
        processStream();
      })
      .catch((error) => {
        console.error("Error setting up stream connection:", error);
        this.running = false;
      });
  }

  /**
   * Handles messages received from the stream
   * @param message The parsed message from the stream
   */
  private handleStreamMessage(message: any): void {
    if (this.config.verbose) {
      console.log("MCP Streamable HTTP message:", message);
    }

    if (message.id && this.pendingRequests.has(message.id)) {
      const pendingRequest = this.pendingRequests.get(message.id);
      if (pendingRequest) {
        const { resolve, reject } = pendingRequest;
        this.pendingRequests.delete(message.id);

        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message.result);
        }
      }
    }
  }

  /**
   * Generates a unique session ID if one is not provided by the server
   * @returns A unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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

    try {
      const requestId = this.requestId++;

      // Create a promise that will be resolved when we get a response
      const responsePromise = new Promise<MCPTool[]>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });

        // Add timeout for safety
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(new Error("Timeout waiting for MCP server response"));
          }
        }, this.config.timeout || 5000);
      });

      // Send request for tool list
      const message = JSON.stringify({
        id: requestId,
        type: "list_tools",
        sessionId: this.sessionId,
      });

      // Send HTTP request to the server
      try {
        await axios.post(this.baseUrl.toString(), message, {
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
          },
        });
      } catch (error) {
        console.error(
          `Failed to send request to Streamable HTTP server: ${error}`
        );
        throw new Error(
          `Communication with Streamable HTTP server failed: ${error}`
        );
      }

      const tools = await responsePromise;
      if (this.config.verbose) {
        console.log("Discovered MCP tools:", tools);
      }
      this.cachedTools = tools;
      return tools;
    } catch (error) {
      throw new Error(`Failed to list MCP tools: ${error}`);
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

    try {
      const requestId = this.requestId++;

      // Create a promise that will be resolved when we get a response
      const responsePromise = new Promise<any>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });

        // Add timeout for safety
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(new Error("Timeout waiting for MCP server response"));
          }
        }, this.config.timeout || 30000); // Longer timeout for tool calls
      });

      // Send request to call tool
      const message = JSON.stringify({
        id: requestId,
        type: "call_tool",
        tool: toolName,
        params,
        sessionId: this.sessionId,
      });

      if (this.config.verbose) {
        console.log("Sending MCP tool call:", message);
      }

      // Send HTTP request to the server
      try {
        await axios.post(this.baseUrl.toString(), message, {
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
          },
        });
      } catch (error) {
        console.error(
          `Failed to send request to Streamable HTTP server: ${error}`
        );
        throw new Error(
          `Communication with Streamable HTTP server failed: ${error}`
        );
      }

      return await responsePromise;
    } catch (error) {
      throw new Error(`Failed to call MCP tool ${toolName}: ${error}`);
    }
  }

  /**
   * Closes the MCP server connection
   */
  async close(): Promise<void> {
    if (this.running) {
      try {
        // Send a close session message to the server
        if (this.sessionId) {
          await axios.post(
            this.baseUrl.toString(),
            JSON.stringify({
              type: "close_session",
              sessionId: this.sessionId,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                ...this.config.headers,
              },
            }
          );
        }
      } catch (error) {
        // Log but don't throw - we still want to clean up
        console.error("Error closing Streamable HTTP session:", error);
      } finally {
        this.running = false;
        this.sessionId = null;
        this.cachedTools = null;

        // Reject all pending requests
        for (const [, { reject }] of this.pendingRequests) {
          reject(new Error("Connection closed"));
        }
        this.pendingRequests.clear();

        if (this.config.verbose) {
          console.log("MCP Streamable HTTP connection closed");
        }
      }
    }
  }
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
 * A Tool implementation that wraps an MCP server tool
 */
export class MCPToolWrapper extends Tool {
  private mcpConnection: MCPServerConnection;
  private mcpToolName: string;

  /**
   * Creates a new MCP tool wrapper
   * @param mcpTool Tool definition from the MCP server
   * @param mcpConnection Connection to the MCP server
   */
  constructor(mcpTool: MCPTool, mcpConnection: MCPServerConnection) {
    super(
      mcpTool.name,
      mcpTool.description,
      mcpTool.parameters,
      mcpTool.returnType
    );

    this.mcpConnection = mcpConnection;
    this.mcpToolName = mcpTool.name;
  }

  /**
   * Runs the MCP tool
   * @param params Parameters for the tool
   * @returns Result of the tool execution
   */
  protected async run(params: Record<string, any>): Promise<any> {
    return await this.mcpConnection.callTool(this.mcpToolName, params);
  }
}

/**
 * Creates an MCP server connection based on configuration
 * @param type Type of MCP server protocol
 * @param config Configuration for the MCP server
 * @returns An MCP server connection
 */
export function createMCPConnection(
  type: MCPProtocolType,
  config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig
): MCPServerConnection {
  switch (type) {
    case MCPProtocolType.STDIO:
      return new MCPStdioConnection(config as MCPStdioConfig);
    case MCPProtocolType.SSE:
      console.warn(
        "Warning: SSE transport is deprecated. Consider using Streamable HTTP instead."
      );
      return new MCPSseConnection(config as MCPSseConfig);
    case MCPProtocolType.STREAMABLE_HTTP:
      return new MCPStreamableHttpConnection(config as MCPStreamableHttpConfig);
    default:
      throw new Error(`Unsupported MCP protocol type: ${type}`);
  }
}

/**
 * Manager for MCP server connections and tools
 */
export class MCPManager {
  private connections: MCPServerConnection[] = [];
  private tools: MCPToolWrapper[] = [];

  /**
   * Adds an MCP server connection
   * @param connection MCP server connection to add
   */
  async addConnection(connection: MCPServerConnection): Promise<void> {
    await connection.initialize();

    // Get tools from the connection
    const mcpTools = await connection.listTools();

    // Create wrappers for each tool
    for (const mcpTool of mcpTools) {
      const wrapper = new MCPToolWrapper(mcpTool, connection);
      this.tools.push(wrapper);
    }

    this.connections.push(connection);
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
    for (const connection of this.connections) {
      await connection.close();
    }

    this.connections = [];
    this.tools = [];
  }
}
