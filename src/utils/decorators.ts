import type { RateLimiterConfig } from "../types";

/**
 * Visualizer decorator. Enables visualization/debug timeline for team runs.
 *
 * Usage:
 *   @Visualizer()
 *   @forge()
 *   class MyForge {}
 */
export function Visualizer(): ClassDecorator {
  return (target: any) => {
    target.__visualizerEnabled = true;
    return target;
  };
}

export function RateLimiter(config: RateLimiterConfig): ClassDecorator {
  return (target: any) => {
    target.rateLimiterConfig = config;
    return target;
  };
}
