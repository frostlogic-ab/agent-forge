import type { ChatCompletionTool } from "token.js";
import type { ToolConfig, ToolParameter } from "../types";

/**
 * Base class for all tools that can be used by agents
 */
export abstract class Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameter[];
  readonly returnType?: string;

  /**
   * Creates a new tool
   * @param name Name of the tool
   * @param description Description of what the tool does
   * @param parameters Parameters that the tool accepts
   * @param returnType Description of what the tool returns
   */
  constructor(
    name: string,
    description: string,
    parameters: ToolParameter[] = [],
    returnType?: string
  ) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.returnType = returnType;
  }

  /**
   * Validates that all required parameters are provided and have the correct type
   * @param params Parameters to validate
   * @returns True if the parameters are valid, throws an error otherwise
   */
  validateParams(params: Record<string, any>): boolean {
    this.validateRequiredParams(params);
    this.validateParamTypes(params);
    return true;
  }

  private validateRequiredParams(params: Record<string, any>): void {
    for (const param of this.parameters) {
      if (
        param.required &&
        (params[param.name] === undefined || params[param.name] === null)
      ) {
        throw new Error(`Required parameter '${param.name}' is missing`);
      }
    }
  }

  private validateParamTypes(params: Record<string, any>): void {
    for (const [name, value] of Object.entries(params)) {
      const paramDef = this.parameters.find((p) => p.name === name);
      if (!paramDef) {
        throw new Error(`Unknown parameter '${name}'`);
      }
      this.validateType(name, value, paramDef.type);
    }
  }

  private validateType(name: string, value: unknown, type: string): void {
    const typeMap: Record<string, (v: unknown) => boolean> = {
      string: (v) => typeof v === "string",
      number: (v) => typeof v === "number",
      boolean: (v) => typeof v === "boolean",
      array: (v) => Array.isArray(v),
      object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
    };

    const validator = typeMap[type.toLowerCase()];
    if (!validator || !validator(value)) {
      throw new Error(`Parameter '${name}' must be a ${type}`);
    }
  }

  /**
   * Executes the tool with the given parameters
   * @param params Parameters to execute the tool with
   * @returns The result of the tool execution
   */
  async execute(params: Record<string, any>): Promise<any> {
    // Validate parameters
    this.validateParams(params);

    // Apply default values for missing parameters
    const fullParams = { ...params };
    for (const param of this.parameters) {
      if (fullParams[param.name] === undefined && param.default !== undefined) {
        fullParams[param.name] = param.default;
      }
    }

    // Execute the tool
    try {
      return await this.run(fullParams);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Error executing tool '${this.name}': ${error.message}`
        );
      }

      throw new Error(`Error executing tool '${this.name}': Unknown error`);
    }
  }

  /**
   * The actual implementation of the tool
   * @param params Parameters to run the tool with
   * @returns The result of the tool execution
   */
  protected abstract run(params: Record<string, any>): Promise<any>;

  /**
   * Gets the tool configuration for use with LLMs
   * @returns Tool configuration object
   */
  getConfig(): ToolConfig {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      returnType: this.returnType,
    };
  }

  getChatCompletionConfig(): ChatCompletionTool {
    const parameters = this.parameters.reduce(
      (acc: any, parameter: ToolParameter) => {
        acc.properties[parameter.name] = {
          type: parameter.type,
          description: parameter.description,
        };
        if (parameter.required) {
          acc.required.push(parameter.name);
        }
        return acc;
      },
      {
        type: "object",
        properties: {},
        required: [],
      }
    );

    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: parameters,
      },
    };
  }
}
