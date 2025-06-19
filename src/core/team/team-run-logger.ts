/**
 * TeamRunLogger: Captures all significant events during a team run for visualization/debugging.
 *
 * @module TeamRunLogger
 */

import { logger } from "../agent-logger";

export interface TeamRunEvent {
  timestamp: number;
  type: string;
  actor?: string;
  summary: string;
  details: Record<string, unknown>;
}

/**
 * Logger for capturing team run events in a structured way.
 *
 * @example
 *   const logger = new TeamRunLogger();
 *   logger.log({ type: 'Agent Prompt', ... });
 *   const events = logger.getEvents();
 */
export class TeamRunLogger {
  private events: TeamRunEvent[] = [];

  /**
   * Log a new event.
   * @param event The event to log
   */
  log(event: TeamRunEvent): void {
    this.events.push({ ...event, timestamp: event.timestamp || Date.now() });
  }

  /**
   * Get all logged events.
   */
  getEvents(): TeamRunEvent[] {
    return [...this.events];
  }

  /**
   * Get enhanced logging data from AgentLogger
   */
  getEnhancedData() {
    return {
      recentLogs: logger.getRecentLogs(100),
      errorLogs: logger.getErrorLogs(50),
      errorStats: logger.getErrorStats(),
    };
  }

  /**
   * Clear all logged events.
   */
  clear(): void {
    this.events = [];
  }
}
