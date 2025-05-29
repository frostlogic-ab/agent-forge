import { Plugin, PluginLifecycleHooks, type PluginHookData } from '../../../plugins/plugin-manager';

export class SecurityPlugin extends Plugin {
  readonly name = 'security';
  readonly version = '1.0.0';
  readonly priority = 90; // High priority to run security checks early

  private allowedTools = ['WebSearchTool', 'CalculatorTool'];
  private sensitivePatterns = [
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, // Credit card pattern
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email pattern
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN pattern
  ];

  getHooks() {
    return {
      [PluginLifecycleHooks.AGENT_BEFORE_RUN]: this.validateInput.bind(this),
      [PluginLifecycleHooks.TOOL_BEFORE_EXECUTE]: this.validateToolCall.bind(this),
    };
  }

  private validateInput(data: PluginHookData): any {
    const { input } = data.payload;
    
    // Check for sensitive patterns
    if (this.containsSensitiveData(input)) {
      this.log('⚠️ Input contains potentially sensitive data - sanitizing', 'warn');
      const sanitizedInput = this.sanitizeInput(input);
      return { ...data.payload, input: sanitizedInput };
    }
    
    return data.payload;
  }

  private validateToolCall(data: PluginHookData): any {
    const { toolName } = data.payload;
    
    // Validate tool permissions
    if (!this.isToolAllowed(toolName)) {
      this.log(`❌ Tool ${toolName} is not allowed by security policy`, 'error');
      throw new Error(`Tool ${toolName} is not allowed by security policy`);
    }
    
    this.log(`✅ Tool ${toolName} security check passed`);
    return data.payload;
  }

  private containsSensitiveData(input: string): boolean {
    return this.sensitivePatterns.some(pattern => pattern.test(input));
  }

  private sanitizeInput(input: string): string {
    let sanitized = input;
    for (const pattern of this.sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  private isToolAllowed(toolName: string): boolean {
    return this.allowedTools.includes(toolName);
  }

  // Public methods for configuration
  addAllowedTool(toolName: string): void {
    if (!this.allowedTools.includes(toolName)) {
      this.allowedTools.push(toolName);
      this.log(`Added ${toolName} to allowed tools list`);
    }
  }

  removeAllowedTool(toolName: string): void {
    const index = this.allowedTools.indexOf(toolName);
    if (index > -1) {
      this.allowedTools.splice(index, 1);
      this.log(`Removed ${toolName} from allowed tools list`);
    }
  }

  getAllowedTools(): string[] {
    return [...this.allowedTools];
  }
} 