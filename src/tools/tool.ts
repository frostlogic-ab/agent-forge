import { z } from "zod";
import type { ChatCompletionTool } from "token.js";
import { ToolConfig, ToolParameter, ToolParameterSchema, ToolConfigSchema } from "../types";

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
    const schema = z.object(
      this.parameters.reduce((acc, param) => {
        let paramSchema: z.ZodTypeAny;
        switch (param.type) {
          case "string":
            paramSchema = z.string();
            break;
          case "number":
            paramSchema = z.number();
            break;
          case "boolean":
            paramSchema = z.boolean();
            break;
          case "array":
            paramSchema = z.array(z.any()); // More specific array types could be added if needed
            break;
          case "object":
            paramSchema = z.object({}); // More specific object schemas could be added if needed
            break;
          default:
            paramSchema = z.any();
        }
        acc[param.name] = param.required ? paramSchema : paramSchema.optional();
        return acc;
      }, {} as Record<string, z.ZodTypeAny>)
    );

    try {
      schema.parse(params);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Tool parameter validation failed for ${this.name}: ${error.errors.map(e => e.message).join(", ")}`);
      } else {
        throw new Error(`Unknown error during tool parameter validation for ${this.name}: ${error}`);
      }
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
    const config: ToolConfig = {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      returnType: this.returnType,
    };
    try {
      ToolConfigSchema.parse(config);
      return config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Tool configuration validation failed for ${this.name}: ${error.errors.map(e => e.message).join(", ")}`);
      } else {
        throw new Error(`Unknown error during tool configuration validation for ${this.name}: ${error}`);
      }
    }
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
