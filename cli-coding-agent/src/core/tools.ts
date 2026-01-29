import * as fs from "fs";
import * as path from "path";
import {spawn} from "child_process"
import { resolve } from "dns";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export function ensureWorkspace(workspaceDir: string): void {
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true});
  }
}

export function saveFile(
  workspaceDir: string,
  filename: string,
  content: string
): ToolResult {
  try {
    ensureWorkspace(workspaceDir)
    const filepath = path.join(workspaceDir, filename);
    fs.writeFileSync(filepath, content, "utf-8");
    return {
      success: true,
      output: `File saved: ${filepath}`,
    };
  } catch (err) {
    return {
      success: false, 
      output: "",
      error: `Failed to save file: ${err}`,
    }
  }
}

export function readFile(workspaceDir: string, filename: string):
ToolResult {
  try {
    const filepath = path.join(workspaceDir, filename);
      const content = fs.readFileSync(filepath, "utf-8");
      return {
        success: true,
        output: content
      };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Failed to read file: ${err}`
    };
  }
}

export function listFiles(workspaceDir: string): ToolResult{
  try {
    ensureWorkspace(workspaceDir);
    const files = fs.readdirSync(workspaceDir);
    return {
      success: true,
      output: files.length > 0 ? files.join("\n") : "(empty)"
    };
  } catch (err) {
    return {
      success: false, 
      output: "",
      error: `Failed to list files: ${err}`,
    };
  }
}

export function deleteFile(workspaceDir: string, filename: string):
ToolResult {
  try {
    const filepath = path.join(workspaceDir, filename);
    fs.unlinkSync(filepath);
    return {
      success: true,
      output: `Deleted: ${filename}`
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Failed to delete file: ${err}`
    };
  }
}

export async function runCommand(
  command: string,
  args: string[] = [],
  workspaceDir: string
): Promise<ToolResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, args, {
        cwd: workspaceDir,
        shell: true,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          output: stdout || "(no output)",
          error: stderr || undefined,
        });
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          output: "",
          error: `Failed to run command: ${err.message}`,
        });
      });

      setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          output: stdout,
          error: "Command timed out (30s)",
        });
      }, 30000);
    } catch (err) {
      resolve({
        success: false,
        output: "",
        error: `Failed to run command: ${err}`,
      });
    }
  });
}

// Get file extension runner
export function getRunner(filename: string): { cmd: string; args: string[] } | null {
  const ext = path.extname(filename).toLowerCase();
  
  const runners: Record<string, { cmd: string; args: string[] }> = {
    ".js": { cmd: "bun", args: [filename] },
    ".ts": { cmd: "bun", args: [filename] },
    ".py": { cmd: "python", args: [filename] },
    ".sh": { cmd: "bash", args: [filename] },
    ".ps1": { cmd: "powershell", args: ["-File", filename] },
    ".bat": { cmd: "cmd", args: ["/c", filename] },
    ".rb": { cmd: "ruby", args: [filename] },
    ".go": { cmd: "go", args: ["run", filename] },
    ".rs": { cmd: "cargo", args: ["script", filename] },
  };

  return runners[ext] || null;
}

// Run a script file
export async function runScript(
  workspaceDir: string,
  filename: string
): Promise<ToolResult> {
  const runner = getRunner(filename);
  
  if (!runner) {
    return {
      success: false,
      output: "",
      error: `No runner configured for this file type: ${filename}`,
    };
  }

  const filepath = path.join(workspaceDir, filename);
  
  if (!fs.existsSync(filepath)) {
    return {
      success: false,
      output: "",
      error: `File not found: ${filename}`,
    };
  }

  return runCommand(runner.cmd, runner.args, workspaceDir);
}