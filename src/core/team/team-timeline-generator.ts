/**
 * Utility to generate an HTML timeline from TeamRunLogger events.
 *
 * @module TeamTimelineGenerator
 */
import { promises as fs } from "node:fs";
import { LogLevel, logger } from "../agent-logger";
import type { LogEntry } from "../agent-logger";
import { ErrorAnalyzer } from "../error-recovery";
import type { TeamRunEvent } from "./team-run-logger";

/**
 * Generates an HTML timeline for team run events.
 * @param events Array of TeamRunEvent
 * @returns HTML string
 */
export function generateTeamRunTimelineHtml(events: TeamRunEvent[]): string {
  // Group events by tasks and create task cards
  const taskCards = createTaskCards(events);
  // Show ALL events in the timeline - don't filter out task events
  const timelineEvents = events;

  // Get enhanced logging data
  const recentLogs = logger.getRecentLogs(100);
  const errorLogs = logger.getErrorLogs(50);
  const errorTrends = ErrorAnalyzer.getErrorTrends();

  // Extract performance and error insights from logs
  const performanceMetrics = extractPerformanceMetrics(recentLogs);
  const toolExecutionData = extractToolExecutionData(recentLogs);
  const llmInteractionData = extractLLMInteractionData(recentLogs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Agent Forge Team Run Timeline</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      margin: 0; 
      padding: 0; 
      min-height: 100vh;
    }
    
    .header { 
      background: rgba(255,255,255,0.1); 
      backdrop-filter: blur(10px);
      color: #fff; 
      padding: 2rem; 
      text-align: center;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    }
    
    .header h1 { 
      margin: 0; 
      font-size: 2.5rem; 
      font-weight: 300;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    
    .header .subtitle {
      margin-top: 0.5rem;
      opacity: 0.9;
      font-size: 1.1rem;
    }
    
    .timeline { 
      max-width: 1200px; 
      margin: 2rem auto; 
      padding: 0 1rem;
    }
    
    .section {
      margin-bottom: 3rem;
    }
    
    .section-title {
      color: #fff;
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      padding-left: 0.5rem;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    
    .task-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    
    .task-card { 
      background: #fff; 
      border-radius: 12px; 
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: 1px solid rgba(255,255,255,0.2);
    }
    
    .task-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 48px rgba(0,0,0,0.15);
    }
    
    .task-header { 
      padding: 1.5rem; 
      border-bottom: 1px solid #e9ecef;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
    }
    
    .task-id { 
      font-size: 0.85rem; 
      color: #6c757d; 
      font-weight: 500;
      margin-bottom: 0.5rem;
    }
    
    .task-title { 
      font-size: 1.1rem; 
      font-weight: 600; 
      color: #212529;
      margin-bottom: 0.75rem;
      line-height: 1.4;
    }
    
    .task-agent { 
      display: inline-block;
      background: linear-gradient(135deg, #007bff, #0056b3);
      color: #fff; 
      padding: 0.4rem 0.8rem; 
      border-radius: 20px; 
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
    }
    
    .task-status { 
      display: inline-block;
      padding: 0.3rem 0.7rem; 
      border-radius: 15px; 
      font-size: 0.8rem;
      font-weight: 500;
      margin-left: 0.5rem;
    }
    
    .status-completed { background: linear-gradient(135deg, #28a745, #20c997); color: #fff; }
    .status-pending { background: linear-gradient(135deg, #ffc107, #ffb300); color: #212529; }
    .status-failed { background: linear-gradient(135deg, #dc3545, #c82333); color: #fff; }
    .status-in_progress { background: linear-gradient(135deg, #17a2b8, #138496); color: #fff; }
    
    .task-body { 
      padding: 1.5rem; 
    }
    
    .task-description { 
      color: #495057; 
      line-height: 1.6;
      margin-bottom: 1rem;
      font-size: 0.95rem;
    }
    
    .task-dependencies {
      margin-bottom: 1rem;
    }
    
    .task-dependencies-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: #6c757d;
      margin-bottom: 0.5rem;
    }
    
    .dependency-tag {
      display: inline-block;
      background: #e9ecef;
      color: #495057;
      padding: 0.2rem 0.5rem;
      border-radius: 10px;
      font-size: 0.75rem;
      margin-right: 0.3rem;
      margin-bottom: 0.3rem;
    }
    
    .task-timing {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      color: #6c757d;
      padding-top: 1rem;
      border-top: 1px solid #e9ecef;
    }
    
    .task-duration {
      font-weight: 500;
    }
    
    .task-result {
      margin-top: 1rem;
      padding: 1rem;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #007bff;
    }
    
    .task-result-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: #495057;
      margin-bottom: 0.5rem;
    }
    
    .task-result-content {
      font-size: 0.9rem;
      color: #212529;
      line-height: 1.5;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    
    .event-list {
      display: grid;
      gap: 1rem;
    }
    
    .event { 
      background: rgba(255,255,255,0.95); 
      border-radius: 8px; 
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    
    .event-summary { 
      cursor: pointer; 
      padding: 1rem; 
      display: flex; 
      align-items: center;
      transition: background-color 0.2s ease;
    }
    
    .event-summary:hover { 
      background: rgba(248,249,250,0.8); 
    }
    
    .event-details { 
      display: none; 
      padding: 1rem; 
      background: #f8f9fa;
      border-top: 1px solid #e9ecef;
    }
    
    .event.open .event-details { 
      display: block; 
    }
    
    .event-type { 
      font-size: 0.85rem; 
      color: #fff; 
      padding: 0.3rem 0.6rem;
      border-radius: 12px;
      margin-right: 1rem;
      font-weight: 500;
      min-width: 120px;
      text-align: center;
    }
    
    .event-type.TaskCreated { background: linear-gradient(135deg, #28a745, #20c997); }
    .event-type.TaskAssigned { background: linear-gradient(135deg, #17a2b8, #138496); }
    .event-type.AgentResponse { background: linear-gradient(135deg, #007bff, #0056b3); }
    .event-type.TaskStatusChanged { background: linear-gradient(135deg, #ffc107, #ffb300); color: #212529; }
    .event-type.TeamRunStarted { background: linear-gradient(135deg, #6f42c1, #5a32a3); }
    .event-type.TeamRunCompleted { background: linear-gradient(135deg, #fd7e14, #e55a4e); }
    
    .event-message {
      flex: 1;
      font-weight: 500;
      color: #212529;
    }
    
    .event-timestamp { 
      font-size: 0.8rem; 
      color: #868e96; 
      font-weight: 500;
    }
    
    pre { 
      background: #212529; 
      color: #f8f9fa;
      padding: 1rem; 
      border-radius: 6px; 
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.4;
      text-wrap: auto;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .stat-card {
      background: rgba(255,255,255,0.95);
      padding: 1.5rem;
      border-radius: 8px;
      text-align: center;
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    }
    
    .stat-number {
      font-size: 2rem;
      font-weight: 700;
      color: #007bff;
      margin-bottom: 0.5rem;
    }
    
    .stat-label {
      color: #6c757d;
      font-size: 0.9rem;
      font-weight: 500;
    }
    
    /* Performance Analytics Styles */
    .subsection {
      margin-bottom: 2rem;
    }
    
    .tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
    }
    
    .performance-card {
      background: #fff;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border: 1px solid #e9ecef;
    }
    
    .performance-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e9ecef;
    }
    
    .tool-name {
      font-weight: 600;
      color: #495057;
      font-size: 1rem;
    }
    
    .success-rate {
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    
    .success-rate.success { background: #d4edda; color: #155724; }
    .success-rate.warning { background: #fff3cd; color: #856404; }
    .success-rate.error { background: #f8d7da; color: #721c24; }
    
    .performance-stats {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.9rem;
    }
    
    .stat-row span:first-child {
      color: #6c757d;
      font-weight: 500;
    }
    
    .stat-row span:last-child {
      color: #495057;
      font-weight: 600;
    }
    
    /* Error Analysis Styles */
    .no-errors-card {
      background: #d4edda;
      border: 1px solid #c3e6cb;
      border-radius: 8px;
      padding: 3rem;
      text-align: center;
      color: #155724;
    }
    
    .success-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    
    .error-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .error-stat-card {
      background: #fff;
      border-radius: 8px;
      padding: 1.5rem;
      text-align: center;
      border: 1px solid #e9ecef;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .error-stat-number {
      font-size: 2rem;
      font-weight: 700;
      color: #dc3545;
      margin-bottom: 0.5rem;
    }
    
    .error-stat-label {
      color: #6c757d;
      font-size: 0.9rem;
      font-weight: 500;
    }
    
    .error-types-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .error-type-card {
      background: #fff;
      border-radius: 8px;
      padding: 1rem;
      border: 1px solid #e9ecef;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .error-type-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .error-type-name {
      font-weight: 600;
      color: #495057;
    }
    
    .error-count {
      background: #dc3545;
      color: #fff;
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    
    .error-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .error-item {
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e9ecef;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .error-item:hover {
      background: #f8f9fa;
    }
    
    .error-summary {
      padding: 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .error-timestamp {
      font-size: 0.8rem;
      color: #6c757d;
      font-weight: 500;
      min-width: 80px;
    }
    
    .error-message {
      flex: 1;
      color: #495057;
      font-weight: 500;
    }
    
    .error-context {
      font-size: 0.85rem;
      color: #007bff;
      background: #e7f3ff;
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
    }
    
    .error-details {
      padding: 1rem;
      background: #f8f9fa;
      border-top: 1px solid #e9ecef;
    }
    
    /* Logs Section Styles */
    .logs-container {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-height: 600px;
      overflow-y: auto;
    }
    
    .log-entry {
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e9ecef;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .log-entry:hover {
      background: #f8f9fa;
    }
    
    .log-summary {
      padding: 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .log-level {
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      min-width: 60px;
      text-align: center;
    }
    
    .log-level.debug { background: #e2e3e5; color: #495057; }
    .log-level.info { background: #d1ecf1; color: #0c5460; }
    .log-level.warning { background: #fff3cd; color: #856404; }
    .log-level.error { background: #f8d7da; color: #721c24; }
    .log-level.critical { background: #721c24; color: #fff; }
    
    .log-timestamp {
      font-size: 0.8rem;
      color: #6c757d;
      font-weight: 500;
      min-width: 80px;
    }
    
    .log-message {
      flex: 1;
      color: #495057;
      font-weight: 500;
    }
    
    .log-agent {
      font-size: 0.85rem;
      color: #007bff;
      background: #e7f3ff;
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
    }
    
    .log-details {
      padding: 1rem;
      background: #f8f9fa;
      border-top: 1px solid #e9ecef;
    }
    
    .log-context {
      font-size: 0.9rem;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Agent Forge Team Timeline</h1>
    <div class="subtitle">Task execution visualization and analysis</div>
  </div>
  
  <div class="timeline">
    ${generateOverviewSection(taskCards, performanceMetrics, errorTrends)}
    
    <div class="section">
      <div class="section-title">📋 Task Execution</div>
      <div class="task-grid">
        ${taskCards.map((card) => generateTaskCard(card)).join("")}
      </div>
    </div>
    
    ${generatePerformanceSection(toolExecutionData, llmInteractionData)}
    
    ${generateErrorAnalysisSection(errorLogs, errorTrends)}
    
    ${generateAgentLogsSection(recentLogs)}
    
    ${
      timelineEvents.length > 0
        ? `
    <div class="section">
      <div class="section-title">📊 Complete Event Timeline</div>
      <div class="event-list">
        ${timelineEvents.map((event, idx) => generateEventCard(event, idx)).join("")}
      </div>
    </div>
    `
        : ""
    }
  </div>
  
  <script>
    function toggleEvent(idx) {
      var el = document.getElementById('event-' + idx);
      if (el.classList.contains('open')) {
        el.classList.remove('open');
      } else {
        el.classList.add('open');
      }
    }
    
    function toggleErrorDetails(idx) {
      var el = document.getElementById('error-details-' + idx);
      if (el.style.display === 'none') {
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }
    
    function toggleLogDetails(idx) {
      var el = document.getElementById('log-details-' + idx);
      if (el.style.display === 'none') {
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }
  </script>
</body>
</html>`;
}

function createTaskCards(events: TeamRunEvent[]) {
  const tasks = new Map();

  // Group events by task
  events.forEach((event) => {
    if (event.type === "TaskCreated" && event.details.taskId) {
      const taskId = event.details.taskId as string;
      if (!tasks.has(taskId)) {
        tasks.set(taskId, {
          id: taskId,
          agent: event.details.agentName,
          description: event.details.description,
          dependencies: event.details.dependencies || [],
          status: "pending",
          createdAt: event.timestamp,
          result: null,
          completedAt: null,
        });
      }
    } else if (event.type === "AgentResponse" && event.details.taskId) {
      const taskId = event.details.taskId as string;
      const task = tasks.get(taskId);
      if (task) {
        task.result = event.details.result;
        task.completedAt = event.timestamp;
        task.status = "completed";
      }
    } else if (event.type === "TaskStatusChanged" && event.details.taskId) {
      const taskId = event.details.taskId as string;
      const task = tasks.get(taskId);
      if (task) {
        task.status = event.details.status;
      }
    }
  });

  return Array.from(tasks.values());
}

function generateTaskCard(task: any): string {
  const duration =
    task.completedAt && task.createdAt
      ? `${((task.completedAt - task.createdAt) / 1000).toFixed(1)}s`
      : "-";

  const description = task.description
    ? task.description.split("**Depends on:**")[0].trim()
    : "No description provided";

  return `
    <div class="task-card">
      <div class="task-header">
        <div class="task-id">${task.id}</div>
        <div class="task-title">${description}</div>
        <div>
          <span class="task-agent">${task.agent}</span>
          <span class="task-status status-${task.status}">${task.status.replace("_", " ")}</span>
        </div>
      </div>
      
      <div class="task-body">
        ${
          task.dependencies && task.dependencies.length > 0
            ? `
          <div class="task-dependencies">
            <div class="task-dependencies-title">Dependencies:</div>
            ${task.dependencies
              .map(
                (dep: string) => `<span class="dependency-tag">${dep}</span>`
              )
              .join("")}
          </div>
        `
            : ""
        }
        
        ${
          task.result
            ? `
          <div class="task-result">
            <div class="task-result-title">Result:</div>
            <div class="task-result-content">${task.result}</div>
          </div>
        `
            : ""
        }
        
        <div class="task-timing">
          <span>Created: ${new Date(task.createdAt).toLocaleTimeString()}</span>
          <span class="task-duration">Duration: ${duration}</span>
        </div>
      </div>
    </div>
  `;
}

function generateEventCard(event: TeamRunEvent, idx: number): string {
  return `
    <div class="event" id="event-${idx}">
      <div class="event-summary" onclick="toggleEvent(${idx})">
        <span class="event-type ${event.type}">${event.type}</span>
        <span class="event-message">${event.summary}</span>
        <span class="event-timestamp">${new Date(event.timestamp).toLocaleString()}</span>
      </div>
      <div class="event-details">
        <strong>Actor:</strong> ${event.actor || "System"}<br/>
        <strong>Details:</strong>
        <pre>${JSON.stringify(event.details, null, 2)}</pre>
      </div>
    </div>
  `;
}

/**
 * Writes the team run timeline HTML to a file.
 * @param events Array of TeamRunEvent
 * @param filePath Path to write the HTML file (default: team-run-timeline.html)
 * @returns The file path written to
 */
export async function writeTeamRunTimelineHtmlToFile(
  events: TeamRunEvent[],
  filePath = "team-run-timeline.html"
): Promise<string> {
  const html = generateTeamRunTimelineHtml(events);
  await fs.writeFile(filePath, html, "utf-8");
  return filePath;
}

// Helper functions for extracting data from logs

function extractPerformanceMetrics(logs: LogEntry[]) {
  const executionLogs = logs.filter((log) => log.context?.executionId);
  const toolLogs = logs.filter((log) => log.context?.toolName);
  const llmLogs = logs.filter((log) => log.context?.model);

  const avgExecutionTime =
    executionLogs.length > 0
      ? executionLogs.reduce((sum, log) => {
          const timeStr = log.context?.executionTime;
          const timeMs = timeStr
            ? Number.parseInt(timeStr.replace("ms", "")) || 0
            : 0;
          return sum + timeMs;
        }, 0) / executionLogs.length
      : 0;

  const totalTokensUsed = logs.reduce(
    (sum, log) => sum + (log.context?.tokenUsage?.total || 0),
    0
  );

  return {
    totalExecutions: executionLogs.length,
    avgExecutionTime: Math.round(avgExecutionTime),
    totalTokensUsed,
    totalToolCalls: toolLogs.length,
    totalLLMCalls: llmLogs.length,
  };
}

function extractToolExecutionData(logs: LogEntry[]) {
  const toolLogs = logs.filter((log) => log.context?.toolName);
  const toolStats = new Map();

  toolLogs.forEach((log) => {
    const toolName = log.context?.toolName;
    if (!toolName) return;

    if (!toolStats.has(toolName)) {
      toolStats.set(toolName, {
        name: toolName,
        totalExecutions: 0,
        successCount: 0,
        errorCount: 0,
        avgExecutionTime: 0,
        totalExecutionTime: 0,
      });
    }

    const stats = toolStats.get(toolName);
    stats.totalExecutions++;

    const executionTimeStr = log.context?.executionTime;
    const executionTimeMs = executionTimeStr
      ? Number.parseInt(executionTimeStr.replace("ms", "")) || 0
      : 0;
    stats.totalExecutionTime += executionTimeMs;

    if (log.level === LogLevel.ERROR) {
      stats.errorCount++;
    } else {
      stats.successCount++;
    }
  });

  // Calculate averages and success rates
  toolStats.forEach((stats) => {
    stats.avgExecutionTime =
      stats.totalExecutions > 0
        ? Math.round(stats.totalExecutionTime / stats.totalExecutions)
        : 0;
    stats.successRate =
      stats.totalExecutions > 0
        ? Math.round((stats.successCount / stats.totalExecutions) * 100)
        : 0;
  });

  return Array.from(toolStats.values());
}

function extractLLMInteractionData(logs: LogEntry[]) {
  const llmLogs = logs.filter((log) => log.context?.model);
  const modelStats = new Map();

  llmLogs.forEach((log) => {
    const modelName = log.context?.model;
    if (!modelName) return;

    if (!modelStats.has(modelName)) {
      modelStats.set(modelName, {
        name: modelName,
        totalRequests: 0,
        totalTokens: 0,
        errorCount: 0,
        avgResponseTime: 0,
        totalResponseTime: 0,
      });
    }

    const stats = modelStats.get(modelName);
    stats.totalRequests++;
    stats.totalTokens += log.context?.tokenUsage?.total || 0;

    const executionTimeStr = log.context?.executionTime;
    const executionTimeMs = executionTimeStr
      ? Number.parseInt(executionTimeStr.replace("ms", "")) || 0
      : 0;
    stats.totalResponseTime += executionTimeMs;

    if (log.level === LogLevel.ERROR) {
      stats.errorCount++;
    }
  });

  // Calculate averages
  modelStats.forEach((stats) => {
    stats.avgResponseTime =
      stats.totalRequests > 0
        ? Math.round(stats.totalResponseTime / stats.totalRequests)
        : 0;
    stats.errorRate =
      stats.totalRequests > 0
        ? Math.round((stats.errorCount / stats.totalRequests) * 100)
        : 0;
  });

  return Array.from(modelStats.values());
}

function generateOverviewSection(
  tasks: any[],
  performanceMetrics: any,
  errorTrends: any
) {
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const errorRate = errorTrends.totalErrors || 0;

  return `
    <div class="section">
      <div class="section-title">📈 Execution Overview</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">${tasks.length}</div>
          <div class="stat-label">Total Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${completedTasks}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${failedTasks}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${performanceMetrics.avgExecutionTime}ms</div>
          <div class="stat-label">Avg Execution</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${performanceMetrics.totalTokensUsed}</div>
          <div class="stat-label">Tokens Used</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${errorRate}</div>
          <div class="stat-label">Error Count</div>
        </div>
      </div>
    </div>
  `;
}

function generatePerformanceSection(toolData: any[], llmData: any[]) {
  return `
    <div class="section">
      <div class="section-title">⚡ Performance Analytics</div>
      
      <div class="subsection">
        <h3 style="color: #495057; margin-bottom: 1rem;">🔧 Tool Performance</h3>
        <div class="tool-grid">
          ${toolData
            .map(
              (tool) => `
            <div class="performance-card">
              <div class="performance-header">
                <span class="tool-name">${tool.name}</span>
                <span class="success-rate ${tool.successRate >= 90 ? "success" : tool.successRate >= 70 ? "warning" : "error"}">${tool.successRate}%</span>
              </div>
              <div class="performance-stats">
                <div class="stat-row">
                  <span>Total Calls:</span>
                  <span>${tool.totalExecutions}</span>
                </div>
                <div class="stat-row">
                  <span>Avg Time:</span>
                  <span>${tool.avgExecutionTime}ms</span>
                </div>
                <div class="stat-row">
                  <span>Errors:</span>
                  <span>${tool.errorCount}</span>
                </div>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
      
      <div class="subsection">
        <h3 style="color: #495057; margin-bottom: 1rem;">🧠 LLM Performance</h3>
        <div class="tool-grid">
          ${llmData
            .map(
              (model) => `
            <div class="performance-card">
              <div class="performance-header">
                <span class="tool-name">${model.name}</span>
                <span class="success-rate ${model.errorRate <= 5 ? "success" : model.errorRate <= 15 ? "warning" : "error"}">${100 - model.errorRate}%</span>
              </div>
              <div class="performance-stats">
                <div class="stat-row">
                  <span>Requests:</span>
                  <span>${model.totalRequests}</span>
                </div>
                <div class="stat-row">
                  <span>Avg Response:</span>
                  <span>${model.avgResponseTime}ms</span>
                </div>
                <div class="stat-row">
                  <span>Total Tokens:</span>
                  <span>${model.totalTokens}</span>
                </div>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function generateErrorAnalysisSection(errorLogs: LogEntry[], errorTrends: any) {
  if (errorLogs.length === 0) {
    return `
      <div class="section">
        <div class="section-title">✅ Error Analysis</div>
        <div class="no-errors-card">
          <div class="success-icon">✅</div>
          <h3>No Errors Detected</h3>
          <p>All operations completed successfully without any errors.</p>
        </div>
      </div>
    `;
  }

  const errorsByType = new Map();
  errorLogs.forEach((log) => {
    const errorType = log.context?.errorType || "Unknown";
    errorsByType.set(errorType, (errorsByType.get(errorType) || 0) + 1);
  });

  return `
    <div class="section">
      <div class="section-title">🚨 Error Analysis</div>
      
      <div class="error-stats-grid">
        <div class="error-stat-card">
          <div class="error-stat-number">${errorLogs.length}</div>
          <div class="error-stat-label">Total Errors</div>
        </div>
        <div class="error-stat-card">
          <div class="error-stat-number">${errorsByType.size}</div>
          <div class="error-stat-label">Error Types</div>
        </div>
        <div class="error-stat-card">
          <div class="error-stat-number">${errorTrends.recoveredErrors || 0}</div>
          <div class="error-stat-label">Recovered</div>
        </div>
      </div>
      
      <div class="error-types-section">
        <h3 style="color: #495057; margin-bottom: 1rem;">Error Breakdown</h3>
        <div class="error-types-grid">
          ${Array.from(errorsByType.entries())
            .map(
              ([type, count]) => `
            <div class="error-type-card">
              <div class="error-type-header">
                <span class="error-type-name">${type}</span>
                <span class="error-count">${count}</span>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
      
      <div class="recent-errors-section">
        <h3 style="color: #495057; margin-bottom: 1rem;">Recent Errors</h3>
        <div class="error-list">
          ${errorLogs
            .slice(0, 5)
            .map(
              (log, idx) => `
            <div class="error-item" onclick="toggleErrorDetails(${idx})">
              <div class="error-summary">
                <span class="error-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                <span class="error-message">${log.message}</span>
                <span class="error-context">${log.agentName || "System"}</span>
              </div>
              <div class="error-details" id="error-details-${idx}" style="display: none;">
                <pre>${JSON.stringify(log.context || {}, null, 2)}</pre>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function generateAgentLogsSection(logs: LogEntry[]) {
  const recentLogs = logs.slice(0, 20);

  return `
    <div class="section">
      <div class="section-title">📋 Agent Execution Logs</div>
      <div class="logs-container">
        ${recentLogs
          .map(
            (log, idx) => `
          <div class="log-entry log-${LogLevel[log.level].toLowerCase()}" onclick="toggleLogDetails(${idx})">
            <div class="log-summary">
              <span class="log-level ${LogLevel[log.level].toLowerCase()}">${LogLevel[log.level]}</span>
              <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="log-message">${log.message}</span>
              <span class="log-agent">${log.agentName || "System"}</span>
            </div>
            <div class="log-details" id="log-details-${idx}" style="display: none;">
              <div class="log-context">
                <strong>Execution ID:</strong> ${log.context?.executionId || "N/A"}<br/>
                <strong>Agent:</strong> ${log.agentName || "N/A"}<br/>
                <strong>Performance:</strong> ${log.context?.executionTime || "0ms"}<br/>
                ${log.context ? `<strong>Context:</strong><pre>${JSON.stringify(log.context, null, 2)}</pre>` : ""}
              </div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}
