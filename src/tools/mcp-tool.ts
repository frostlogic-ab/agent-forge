import { Tool } from "./tool";
import type { ToolParameter } from "../types";
import axios from "axios";
import { EventSourcePolyfill } from "event-source-polyfill";
import { spawn } from "child_process";

// Types to avoid Node.js specific imports
type SpawnProcess = {
  stdin: {
    write: (data: string) => boolean;
  };
  stdout: {
    on: (event: string, callback: (chunk: any) => void) => void;
    off: (event: string, callback: (chunk: any) => void) => void;
  };
  stderr: {
    on: (event: string, callback: (chunk: any) => void) => void;
  };
  on: (event: string, callback: (code: number) => void) => void;
  kill: () => void;
};

type EventSourceType = {
  onopen: ((this: any) => void) | null;
  onmessage: ((this: any, event: MessageEvent) => void) | null;
  onerror: ((this: any, error: Event) => void) | null;
  close: () => void;
};

/**
 * Represents an MCP server protocol type
 */
export enum MCPProtocolType {
  STDIO = "stdio",
  SSE = "sse",
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
}

/**
 * Base class for MCP server connections
 */
export abstract class MCPServerConnection {
  protected running: boolean = false;

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
  private process: SpawnProcess | null = null;
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
      }) as SpawnProcess;

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
      this.process.stdin.write(message + "\n");

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
      this.process.stdin.write(message + "\n");

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
        this.process.stdin.write(JSON.stringify({ type: "exit" }) + "\n");
        // Give it a moment to exit cleanly
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
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
  private eventSource: EventSourceType | null = null;
  private cachedTools: MCPTool[] | null = null;
  private requestId = 0;
  private pendingRequests: Map<
    number,
    { resolve: Function; reject: Function }
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
      }) as unknown as EventSourceType;

      // Set up event handlers
      this.eventSource.onopen = () => {
        this.running = true;
      };

      this.eventSource.onerror = (error: Event) => {
        this.running = false;
        console.error("MCP SSE connection error:", error);

        // Reject all pending requests
        for (const [, { reject }] of this.pendingRequests) {
          reject(new Error("SSE connection error"));
        }
        this.pendingRequests.clear();
      };

      this.eventSource.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && this.pendingRequests.has(data.id)) {
            const { resolve } = this.pendingRequests.get(data.id)!;
            this.pendingRequests.delete(data.id);
            resolve(data.result);
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

        const originalOnOpen = this.eventSource!.onopen;
        this.eventSource!.onopen = function (this: any) {
          clearTimeout(timeout);
          this.running = true;
          resolve();
          if (originalOnOpen) originalOnOpen.call(this);
        }.bind(this);
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
 * Factory for creating MCP server connections
 */
export class MCPConnectionFactory {
  /**
   * Creates an MCP server connection based on configuration
   * @param type Type of MCP server protocol
   * @param config Configuration for the MCP server
   * @returns An MCP server connection
   */
  static create(
    type: MCPProtocolType,
    config: MCPStdioConfig | MCPSseConfig
  ): MCPServerConnection {
    switch (type) {
      case MCPProtocolType.STDIO:
        return new MCPStdioConnection(config as MCPStdioConfig);
      case MCPProtocolType.SSE:
        return new MCPSseConnection(config as MCPSseConfig);
      default:
        throw new Error(`Unsupported MCP protocol type: ${type}`);
    }
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
