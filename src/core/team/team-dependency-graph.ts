import type { Task } from "../../types";

export class TeamDependencyGraph {
  public detectCircularDependencies(
    taskId: string,
    dependencies: string[],
    tasks: Map<string, Task>
  ): string[][] {
    const cycles: string[][] = [];

    // For each dependency, check if it forms a cycle
    for (const depId of dependencies) {
      // Skip non-existent dependencies
      if (!tasks.has(depId)) continue;

      // Check if the dependency directly or indirectly depends on this task
      const visited = new Set<string>();
      const path: string[] = [taskId, depId]; // Start path with current task and its dependency

      // Run DFS to detect cycles
      // Note: The initial call to detectCycleDFS starts from the dependency (depId)
      // and checks if it can reach back to the original task (taskId).
      this.detectCycleDFS(depId, taskId, tasks, visited, path, cycles);

      // If direct dependency creates a cycle, add it (e.g. task-1 depends on task-1)
      if (depId === taskId) {
        // Ensure not to add duplicate if DFS already found it.
        // A simple check: if cycles already contains a path that is just [taskId, taskId]
        if (
          !cycles.some(
            (c) => c.length === 2 && c[0] === taskId && c[1] === taskId
          )
        ) {
          cycles.push([taskId, taskId]);
        }
      }
    }
    return cycles;
  }

  /**
   * Helper for cycle detection using DFS
   * @param currentId The current node ID in the DFS traversal
   * @param targetId The original task ID we are checking for a cycle back to
   * @param tasks The map of all tasks
   * @param visited A set of visited node IDs for the current DFS path to avoid re-visiting in the same path
   * @param path The current path being explored in the DFS
   * @param cycles An array to store any found cycles
   * @returns True if a cycle was found along the current path, false otherwise
   */
  private detectCycleDFS(
    currentId: string,
    targetId: string,
    tasks: Map<string, Task>,
    visited: Set<string>,
    path: string[],
    cycles: string[][]
  ): boolean {
    // If we've already visited this node in this specific DFS traversal (current path),
    // it means we are stuck in a loop within this path but not necessarily a cycle involving the targetId yet.
    // However, for cycle detection with a specific target, this check is more about avoiding redundant work
    // if the graph has general cycles not involving the targetId.
    // The crucial check is `if (depId === targetId)`.
    // For simplicity, we prevent re-processing a node within the *same* active DFS path from one call.
    if (visited.has(currentId)) return false;

    visited.add(currentId);

    const task = tasks.get(currentId);
    if (!task) {
      visited.delete(currentId); // Backtrack visited state if task not found
      return false;
    }

    for (const depId of task.dependencies) {
      // Cycle detected: a dependency of the current node is the target node
      if (depId === targetId) {
        cycles.push([...path, targetId]);
        // Do not return true immediately, continue exploring other paths from currentId
        // as there might be multiple cyclic paths to the targetId.
        // However, for the purpose of simply detecting *a* cycle for this path, we could return.
        // Let's assume we want to find all distinct simple cycles involving the path to targetId.
        // For now, we add and continue. If only one cycle proof is needed, can return true here.
      }

      // If the dependency exists, continue DFS traversal
      if (tasks.has(depId)) {
        path.push(depId);
        // We pass a new Set for 'visited' for sub-paths if we want to find all cycles,
        // or pass the same 'visited' if we only care about simple cycles from the initial call.
        // The current implementation with a single 'visited' set passed down helps avoid re-exploring parts of the graph
        // unnecessarily within one top-level call to detectCircularDependencies for a specific taskId.
        if (
          this.detectCycleDFS(
            depId,
            targetId,
            tasks,
            new Set(visited),
            path,
            cycles
          )
        ) {
          // If a cycle was found down this path, we can propagate `true` up if we only need to find one.
          // But since we collect all cycles in the `cycles` array, we don't strictly need to return true here.
        }
        path.pop(); // Backtrack: remove current dependency from path before exploring next sibling
      }
    }
    // visited.delete(currentId); // Backtrack: remove current node from visited set AFTER exploring all its children
    // Actually, for the way `visited` is used (passed as `new Set(visited)` or per-path), this might not be needed here.
    // If `visited` was shared across all DFS calls from `detectCircularDependencies` without creating `new Set()`, then backtracking `visited` would be crucial.
    return cycles.some((c) => c.includes(targetId) && c.includes(currentId)); // A basic check if any cycle involving currentId and targetId was found.
  }
}
