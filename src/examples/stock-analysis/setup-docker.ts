import { exec } from "child_process";
import { promisify } from "util";

  // Convert exec to promise-based
const execAsync = promisify(exec);

// Function to check and ensure Docker containers are running
export async function ensureDockerContainers() {
    try {
      // Check if Docker daemon is running
      const { stdout: dockerStatus } = await execAsync("docker info");
      console.log(`Docker is running: ${dockerStatus}`);
      
      // Pull required Docker images if they don't exist
      console.log("Ensuring Docker images exist...");
      
      try {
        const { stdout: braveImage } = await execAsync("docker images -q mcp/brave-search");
        if (!braveImage.trim()) {
          console.log("Pulling mcp/brave-search image...");
          await execAsync("docker pull mcp/brave-search");
        } else {
          console.log("mcp/brave-search image exists");
        }
      } catch (error) {
        console.error("Error checking/pulling mcp/brave-search:", error);
        throw new Error("Failed to ensure mcp/brave-search image exists");
      }
      
      return true;
    } catch (error) {
      console.error("Docker check failed:", error);
      throw new Error("Docker daemon is not running or not accessible");
    }
  }