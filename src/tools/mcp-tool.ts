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
      console.log(
        `Starting MCP STDIO process: ${this.config.command} ${this.config.args?.join(" ") || ""}`
      );

      // Create a child process to communicate with the MCP server
      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      console.log("MCP STDIO process spawned, pid:", this.process.pid);

      // Set up error handler
      this.process.on("error", (error) => {
        console.error(`MCP STDIO process error: ${error}`);
        this.running = false;
      });

      // Set up exit handler
      this.process.on("exit", (code) => {
        console.log(`MCP STDIO process exited with code ${code}`);
        this.running = false;
      });

      // Capture all stdout/stderr for debugging
      this.process.stdout.on("data", (data) => {
        console.log(
          `Initial stdout from MCP process: ${data.toString().trim()}`
        );
      });

      this.process.stderr.on("data", (data) => {
        console.error(`MCP STDIO stderr: ${data.toString().trim()}`);
      });

      this.running = true;

      // Wait for the process to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check if process is still running
      if (!this.process || this.process.killed || !this.running) {
        throw new Error(
          "MCP STDIO process failed to start or exited prematurely"
        );
      }

      // Initialize the MCP connection with a handshake
      try {
        console.log("Sending initialization request to MCP process");

        // Clear any existing handlers on stdout before initialization
        this.process.stdout.removeAllListeners("data");

        // Set up handler to capture initialization response
        const initPromise = new Promise<void>((resolve, reject) => {
          const initId = `init-${Date.now()}`;
          let responseData = "";

          const responseHandler = (data: Buffer) => {
            const chunk = data.toString();
            console.log("Init response chunk:", chunk);
            responseData += chunk;

            if (responseData.includes("\n")) {
              try {
                // Parse each line as a potential JSON response
                const lines = responseData
                  .split("\n")
                  .filter((line) => line.trim());
                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line);
                    console.log("Parsed init response:", parsed);

                    // Check if this is a response to our initialization
                    if (parsed.id === initId) {
                      this.process?.stdout.off("data", responseHandler);

                      if (parsed.error) {
                        console.error("Initialization error:", parsed.error);
                        reject(
                          new Error(
                            parsed.error.message ||
                              "Unknown initialization error"
                          )
                        );
                        return;
                      }

                      console.log("MCP successfully initialized");
                      resolve();
                      return;
                    }
                  } catch (_jsonError) {
                    // Skip lines that aren't valid JSON
                  }
                }
              } catch (error) {
                console.error("Failed to parse init response:", error);
              }
            }
          };

          this.process?.stdout.on("data", responseHandler);

          // Set timeout for initialization
          setTimeout(() => {
            this.process?.stdout.off("data", responseHandler);
            console.warn(
              "No initialization response received, continuing anyway"
            );
            resolve(); // Resolve anyway to continue
          }, 2000);

          // Send initialization request according to MCP protocol
          const initRequest = JSON.stringify({
            id: initId,
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              clientInfo: {
                name: "mcp-client",
                version: "1.0.0",
              },
              protocolVersion: "2023-07-01",
              capabilities: {
                tools: {},
              },
            },
          });

          console.log("Initialization request:", initRequest);

          // Send the request
          if (this.process && !this.process.killed) {
            this.process.stdin.write(`${initRequest}\n`);
          } else {
            reject(new Error("Process not available for initialization"));
          }
        });

        // Wait for initialization response or timeout
        await initPromise;
      } catch (initError) {
        console.error("Failed to send initialization request:", initError);
      }

      console.log("MCP STDIO process initialization completed");
    } catch (error) {
      console.error(`Failed to initialize MCP STDIO connection: ${error}`);
      throw new Error(`Failed to initialize MCP STDIO connection: ${error}`);
    }
  }

  /**
   * Helper method to convert tool objects to the MCPTool format
   */
  private convertToolsFormat(toolsArray: any[]): MCPTool[] {
    return toolsArray.map((tool) => {
      const parameters: ToolParameter[] = [];

      // Handle both inputSchema and parameters formats
      if (tool.inputSchema) {
        // Convert JSON Schema format to parameters
        if (tool.inputSchema.properties) {
          Object.entries(tool.inputSchema.properties).forEach(
            ([name, schema]: [string, any]) => {
              parameters.push({
                name,
                description: schema.description || "",
                type: schema.type || "string",
                required: tool.inputSchema.required?.includes(name) || false,
              });
            }
          );
        }
      } else if (tool.parameters && Array.isArray(tool.parameters)) {
        // Direct parameters array
        tool.parameters.forEach((param: any) => {
          parameters.push({
            name: param.name,
            description: param.description || "",
            type: param.type,
            required: param.required || false,
          });
        });
      }

      return {
        name: tool.name,
        description: tool.description || "",
        parameters,
        returnType: tool.returnType,
      };
    });
  }

  /**
   * Creates a promise that resolves when tools list data is received
   */
  private createToolsListPromise(
    requestId: number | string,
    stderrHandler: (data: Buffer) => void,
    exitHandler: (code: number | null) => void
  ): Promise<MCPTool[]> {
    return new Promise<MCPTool[]>((resolve, reject) => {
      let responseData = "";
      const timeoutId = setTimeout(() => {
        console.log(
          "Timeout reached - Response data accumulated:",
          responseData
        );
        this.process?.stdout.off("data", responseHandler);
        this.process?.stderr.off("data", stderrHandler);
        this.process?.off("exit", exitHandler);
        reject(new Error("Timeout waiting for MCP server response"));
      }, 10000); // Increased timeout

      const responseHandler = (data: Buffer) => {
        const chunk = data.toString();
        console.log("Received stdout chunk:", chunk);
        responseData += chunk;

        // Process each line in case we get multiple JSON objects
        if (responseData.includes("\n")) {
          const lines = responseData.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              console.log("Parsed response:", parsed);

              // Check if this is a response to our request
              if (parsed.id === requestId) {
                // Clear timeout since we got our response
                clearTimeout(timeoutId);

                // Check for errors
                if (parsed.error) {
                  // Clean up
                  this.process?.stdout.off("data", responseHandler);
                  this.process?.stderr.off("data", stderrHandler);
                  this.process?.off("exit", exitHandler);

                  reject(new Error(parsed.error.message || "Unknown error"));
                  return;
                }

                // Clean up handlers before resolving
                this.process?.stdout.off("data", responseHandler);
                this.process?.stderr.off("data", stderrHandler);
                this.process?.off("exit", exitHandler);

                // If we got here, process the result
                if (parsed.result) {
                  // Handle the tools array which can be in different formats
                  if (
                    parsed.result.tools &&
                    Array.isArray(parsed.result.tools)
                  ) {
                    // Format: { tools: [...] }
                    console.log("Processing tools from result.tools array");
                    this.cachedTools = this.convertToolsFormat(
                      parsed.result.tools
                    );
                    console.log(
                      `Successfully processed ${this.cachedTools.length} tools`
                    );
                    resolve(this.cachedTools);
                    return;
                  }

                  if (Array.isArray(parsed.result)) {
                    // Format: direct array of tools
                    console.log("Processing tools from direct result array");
                    this.cachedTools = this.convertToolsFormat(parsed.result);
                    console.log(
                      `Successfully processed ${this.cachedTools.length} tools`
                    );
                    resolve(this.cachedTools);
                    return;
                  }
                }

                // If we get here, we couldn't extract tools from the response
                console.log("No tools found in response");
                this.cachedTools = [];
                resolve([]);
                return;
              }
            } catch (jsonError) {
              // Just log and continue if this particular line isn't valid JSON
              console.log(
                "Line not valid JSON or processing error:",
                jsonError
              );
            }
          }
        }
      };

      this.process?.stdout.on("data", responseHandler);
    });
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

    // Check if process is still running
    if (this.process.killed) {
      console.error("MCP STDIO process has been killed");
      this.running = false;
      throw new Error("MCP STDIO process has been killed");
    }

    try {
      console.log(
        "Requesting tools from MCP server using protocol specification..."
      );

      // Add specific stderr handler for debugging
      const stderrHandler = (data: Buffer) => {
        console.error(`MCP STDIO stderr during listTools: ${data.toString()}`);
      };
      this.process.stderr.on("data", stderrHandler);

      // Set up exit handler to detect if the process exits during the call
      const exitHandler = (code: number | null) => {
        console.error(
          `MCP STDIO process exited during listTools call with code ${code}`
        );
        this.running = false;
        throw new Error(`MCP process exited with code ${code}`);
      };
      this.process?.on("exit", exitHandler);

      // Use the official MCP protocol format for listing tools
      const requestId = Date.now();
      const message = JSON.stringify({
        id: requestId,
        method: "tools/list",
        jsonrpc: "2.0",
      });

      console.log("Sending listTools request:", message);

      // Clear any existing handlers on stdout
      this.process.stdout.removeAllListeners("data");

      // Create a promise to handle the response
      let responsePromise = this.createToolsListPromise(
        requestId,
        stderrHandler,
        exitHandler
      );

      // Send the request
      this.process.stdin.write(`${message}\n`);

      try {
        return await responsePromise;
      } catch (error: any) {
        // If the method was not found, try the alternative method name
        if (error.message?.includes("Method not found")) {
          console.log(
            "Method 'tools/list' not found, trying alternative 'listTools'"
          );

          // Try the alternative method name
          const alternativeRequestId = Date.now();
          const alternativeMessage = JSON.stringify({
            id: alternativeRequestId,
            method: "listTools",
            jsonrpc: "2.0",
          });

          console.log(
            "Sending alternative listTools request:",
            alternativeMessage
          );

          // Create a new promise for the alternative request
          responsePromise = this.createToolsListPromise(
            alternativeRequestId,
            stderrHandler,
            exitHandler
          );

          // Send the alternative request
          this.process.stdin.write(`${alternativeMessage}\n`);

          return await responsePromise;
        }

        throw error;
      }
    } catch (error) {
      console.error(`Error in listTools: ${error}`);
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

    // Check if process is still running
    if (this.process.killed) {
      console.error("MCP STDIO process has been killed");
      this.running = false;
      throw new Error("MCP STDIO process has been killed");
    }

    try {
      console.log(`Calling tool ${toolName} with params:`, params);

      // Add specific stderr handler for debugging
      const stderrHandler = (data: Buffer) => {
        console.error(
          `MCP STDIO stderr during tool call ${toolName}: ${data.toString()}`
        );
      };
      this.process.stderr.on("data", stderrHandler);

      // Set up exit handler to detect if the process exits during the call
      const exitHandler = (code: number | null) => {
        console.error(
          `MCP STDIO process exited during tool call with code ${code}`
        );
        this.running = false;
        throw new Error(`MCP process exited with code ${code}`);
      };
      this.process?.on("exit", exitHandler);

      // Use the official MCP protocol format for calling tools
      const requestId = Date.now();
      const message = JSON.stringify({
        id: requestId,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: params,
        },
        jsonrpc: "2.0",
      });

      console.log(`Sending callTool request: ${message}`);

      // Clear any existing handlers on stdout
      this.process.stdout.removeAllListeners("data");

      // Create a promise to handle the response
      const responsePromise = new Promise<any>((resolve, reject) => {
        let responseData = "";
        const timeoutId = setTimeout(() => {
          console.log(
            `Timeout reached waiting for MCP tool ${toolName} response`
          );
          this.process?.stdout.off("data", responseHandler);
          this.process?.stderr.off("data", stderrHandler);
          this.process?.off("exit", exitHandler);
          reject(
            new Error(`Timeout waiting for MCP tool ${toolName} response`)
          );
        }, 30000); // Longer timeout for tool calls

        const responseHandler = (data: Buffer) => {
          const chunk = data.toString();
          console.log(`Received stdout chunk for tool ${toolName}:`, chunk);
          responseData += chunk;

          if (responseData.includes("\n")) {
            try {
              // Parse each line as a potential JSON response
              const lines = responseData
                .split("\n")
                .filter((line) => line.trim());
              for (const line of lines) {
                try {
                  const parsed = JSON.parse(line);
                  console.log(`Parsed response for tool ${toolName}:`, parsed);

                  // Check if this is a response to our request
                  if (parsed.id === requestId) {
                    // Clean up
                    clearTimeout(timeoutId);
                    this.process?.stdout.off("data", responseHandler);
                    this.process?.stderr.off("data", stderrHandler);
                    this.process?.off("exit", exitHandler);

                    if (parsed.error) {
                      reject(
                        new Error(parsed.error.message || "Unknown error")
                      );
                      return;
                    }

                    // Extract the result - could be directly in result or in result.value
                    let result = parsed.result;
                    if (parsed.result && parsed.result.value !== undefined) {
                      result = parsed.result.value;
                    }

                    resolve(result);
                    return;
                  }
                } catch (_jsonError) {
                  // Skip lines that aren't valid JSON
                }
              }
            } catch (parseError) {
              console.error(
                `Failed to parse response for tool ${toolName}:`,
                parseError
              );
            }
          }
        };

        this.process?.stdout.on("data", responseHandler);
      });

      // Send the request
      this.process.stdin.write(`${message}\n`);

      return await responsePromise;
    } catch (error) {
      console.error(`Failed to call MCP tool ${toolName}:`, error);
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
