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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Agent Forge Team Run Timeline</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8f9fa; margin: 0; padding: 0; }
    h1 { background: #343a40; color: #fff; margin: 0; padding: 1rem; }
    .timeline { max-width: 900px; margin: 2rem auto; }
    .event { background: #fff; border-radius: 6px; margin-bottom: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    .event-summary { cursor: pointer; padding: 1rem; border-bottom: 1px solid #eee; font-weight: bold; display: flex; align-items: center; }
    .event-summary:hover { background: #f1f3f5; }
    .event-details { display: none; padding: 1rem; }
    .event.open .event-details { display: block; }
    .event.open .event-summary { background: #e9ecef; }
    .event-type { font-size: 0.9em; color: #495057; margin-right: 1em; }
    .event-timestamp { font-size: 0.85em; color: #868e96; margin-left: auto; }
    pre { background: #f8f9fa; padding: 0.5em; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Agent Forge Team Run Timeline</h1>
  <div class="timeline">
    ${events
      .map(
        (event, idx) => `
      <div class="event" id="event-${idx}">
        <div class="event-summary" onclick="toggleEvent(${idx})">
          <span class="event-type">${event.type}</span>
          <span>${event.summary}</span>
          <span class="event-timestamp">${new Date(event.timestamp).toLocaleString()}</span>
        </div>
        <div class="event-details">
          <strong>Actor:</strong> ${event.actor || "-"}<br/>
          <strong>Details:</strong>
          <pre>${JSON.stringify(event.details, null, 2)}</pre>
        </div>
      </div>
    `
      )
      .join("")}
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
