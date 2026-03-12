import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { LogNodeConfig, LogFileInfo } from "./types.js";

type Platform = "windows" | "wsl" | "posix";

function detectPlatform(): Platform {
  if (process.platform === "win32") return "windows";
  try {
    const release = os.release().toLowerCase();
    if (release.includes("microsoft")) return "wsl";
  } catch {
    // fall through
  }
  return "posix";
}

function toUncPath(sharePath: string): string {
  // Convert forward-slash share path to UNC backslash path
  return sharePath.replace(/\//g, "\\");
}

function toWslPath(sharePath: string): string {
  // Convert //host/share/path to /mnt/ style or just use the forward-slash path
  // For WSL, we'll use cmd.exe with UNC paths directly
  return sharePath;
}

function execFilePromise(
  command: string,
  args: string[],
  timeoutMs = 30000
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            reject(new Error("Node unreachable — operation timed out"));
          } else {
            reject(
              new Error(
                error.message + (stderr ? `\nstderr: ${stderr}` : "")
              )
            );
          }
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export class LogReader {
  private platform: Platform;

  constructor() {
    this.platform = detectPlatform();
  }

  async listFiles(node: LogNodeConfig): Promise<LogFileInfo[]> {
    switch (this.platform) {
      case "windows":
        return this.listFilesNative(node.sharePath);
      case "wsl":
        return this.listFilesWsl(node.sharePath);
      case "posix":
        return this.listFilesNative(node.sharePath);
    }
  }

  async readFile(node: LogNodeConfig, fileName: string): Promise<string> {
    switch (this.platform) {
      case "windows":
        return this.readFileNative(node.sharePath, fileName);
      case "wsl":
        return this.readFileWsl(node.sharePath, fileName);
      case "posix":
        return this.readFileNative(node.sharePath, fileName);
    }
  }

  async tailFile(
    node: LogNodeConfig,
    fileName: string,
    lines: number
  ): Promise<string> {
    switch (this.platform) {
      case "windows":
        return this.tailFileNative(node.sharePath, fileName, lines);
      case "wsl":
        return this.tailFileWsl(node.sharePath, fileName, lines);
      case "posix":
        return this.tailFileNative(node.sharePath, fileName, lines);
    }
  }

  // --- Native fs (Windows or mounted shares on Linux/Mac) ---

  private async listFilesNative(sharePath: string): Promise<LogFileInfo[]> {
    const dirPath =
      this.platform === "windows" ? toUncPath(sharePath) : sharePath;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: LogFileInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === "erl_crash.dump") continue;
      const fullPath = path.join(dirPath, entry.name);
      const stat = await fs.stat(fullPath);
      results.push({
        name: entry.name,
        size: stat.size,
        lastModified: stat.mtime,
      });
    }
    return results.sort(
      (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
    );
  }

  private async readFileNative(
    sharePath: string,
    fileName: string
  ): Promise<string> {
    const dirPath =
      this.platform === "windows" ? toUncPath(sharePath) : sharePath;
    return fs.readFile(path.join(dirPath, fileName), "utf8");
  }

  private async tailFileNative(
    sharePath: string,
    fileName: string,
    lines: number
  ): Promise<string> {
    const dirPath =
      this.platform === "windows" ? toUncPath(sharePath) : sharePath;
    const content = await fs.readFile(path.join(dirPath, fileName), "utf8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  }

  // --- WSL (use cmd.exe / powershell.exe for UNC access) ---

  private async listFilesWsl(sharePath: string): Promise<LogFileInfo[]> {
    const uncPath = toUncPath(sharePath);
    const output = await execFilePromise("cmd.exe", [
      "/c",
      `dir "${uncPath}" /A-D /-C`,
    ]);
    return this.parseDirOutput(output);
  }

  private parseDirOutput(output: string): LogFileInfo[] {
    const results: LogFileInfo[] = [];
    const lines = output.split("\n");
    // dir output lines look like:
    // 03/12/2026  02:25 PM          1234567 rabbit@RMQ-APP1A-P01.log
    const dirLineRegex =
      /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}\s+[AP]M)\s+(\d+)\s+(.+)$/;
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(dirLineRegex);
      if (!match) continue;
      const [, date, time, sizeStr, name] = match;
      if (name === "erl_crash.dump") continue;
      results.push({
        name,
        size: parseInt(sizeStr, 10),
        lastModified: new Date(`${date} ${time}`),
      });
    }
    return results.sort(
      (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
    );
  }

  private async readFileWsl(
    sharePath: string,
    fileName: string
  ): Promise<string> {
    const uncPath = toUncPath(sharePath);
    const filePath = `${uncPath}\\${fileName}`;
    return execFilePromise("cmd.exe", ["/c", `type "${filePath}"`]);
  }

  private async tailFileWsl(
    sharePath: string,
    fileName: string,
    lines: number
  ): Promise<string> {
    const uncPath = toUncPath(sharePath);
    const filePath = `${uncPath}\\${fileName}`;
    return execFilePromise("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-Content -Path '${filePath}' -Tail ${lines} -Encoding UTF8`,
    ]);
  }
}
