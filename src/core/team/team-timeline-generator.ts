/**
 * Utility to generate an HTML timeline from TeamRunLogger events.
 *
 * @module TeamTimelineGenerator
 */
import { promises as fs } from "node:fs";
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
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Agent Forge Team Timeline</h1>
    <div class="subtitle">Task execution visualization and analysis</div>
  </div>
  
  <div class="timeline">
    ${generateStatsSection(events, taskCards)}
    
    <div class="section">
      <div class="section-title">📋 Task Execution</div>
      <div class="task-grid">
        ${taskCards.map((card) => generateTaskCard(card)).join("")}
      </div>
    </div>
    
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
            <div class="task-result-content">${task.result.substring(0, 500)}${task.result.length > 500 ? "..." : ""}</div>
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

function generateStatsSection(_events: TeamRunEvent[], tasks: any[]): string {
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const avgDuration =
    tasks
      .filter((t) => t.completedAt && t.createdAt)
      .reduce((sum, t) => sum + (t.completedAt - t.createdAt), 0) /
    tasks.filter((t) => t.completedAt && t.createdAt).length /
    1000;

  return `
    <div class="section">
      <div class="section-title">📈 Execution Summary</div>
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
          <div class="stat-number">${Number.isNaN(avgDuration) ? "-" : avgDuration.toFixed(1)}s</div>
          <div class="stat-label">Avg Duration</div>
        </div>
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
