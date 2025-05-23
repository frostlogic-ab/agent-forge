export const TASK_FORMAT_PROMPT = `
**For each subtask, use this EXACT format:**
**Task #:** [Task title]
**Team member:** [Team member name]
**Why:** [Brief explanation]
**Subtask:** [Clear description of what they need to do]
**Depends on:** [Task ID(s) from 'Current task status' for PREVIOUSLY COMPLETED tasks, or system-generated IDs for other tasks you are defining in THIS planning step, or "none". The task ID format is "task-1, task-2, task-3" or "none"]

**IMPORTANT:** Tasks will be processed in parallel unless you specify dependencies! For sequential tasks, you MUST use the "Depends on:" field.
**IMPORTANT:** Wait for each team member's response before proceeding with dependent tasks. When all subtasks are completed, provide a final response to the original task.
**NOTE:** You can modify or cancel tasks using the "Modify task:" or "Cancel task:" directives if a workflow gets stuck.`;
