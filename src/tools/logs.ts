import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LogReader } from "../log-reader.js";
import type { LogConfig, LogNodeConfig } from "../types.js";
import {
  parseLogLines,
  filterByLevel,
  searchEntries,
  formatEntries,
} from "../log-parser.js";

function findNode(
  config: LogConfig,
  nodeName: string
): LogNodeConfig | undefined {
  return config.nodes.find((n) => n.nodeName === nodeName);
}

function nodeList(config: LogConfig): string {
  return config.nodes.map((n) => `  - ${n.nodeName}`).join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function currentLogName(nodeName: string): string {
  // Node name is like "rabbit@RMQ-APP1A-P01", log file is "rabbit@RMQ-APP1A-P01.log"
  return `${nodeName}.log`;
}

export function registerLogTools(
  server: McpServer,
  reader: LogReader,
  config: LogConfig
) {
  server.registerTool(
    "list_log_files",
    {
      description:
        "List RabbitMQ log files on configured nodes. Node names match the `node` field from get_queue, get_overview, and list_connections tools — use this to cross-reference which node a queue or connection is on and then check that node's logs.",
      inputSchema: z.object({
        node: z
          .string()
          .optional()
          .describe(
            'RabbitMQ node name (e.g. "rabbit@RMQ-APP1A-P01"). Omit to list files from all configured nodes.'
          ),
      }),
    },
    async ({ node }) => {
      const nodes = node
        ? [findNode(config, node)].filter(
            (n): n is LogNodeConfig => n !== undefined
          )
        : config.nodes;

      if (node && nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown node "${node}". Configured nodes:\n${nodeList(config)}`,
            },
          ],
        };
      }

      const sections: string[] = [];
      for (const n of nodes) {
        try {
          const files = await reader.listFiles(n);
          const lines = files.map(
            (f) =>
              `  ${f.name}  ${formatSize(f.size)}  ${f.lastModified.toISOString()}`
          );
          sections.push(
            `${n.nodeName}:\n${lines.length > 0 ? lines.join("\n") : "  (no log files found)"}`
          );
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : String(err);
          sections.push(`${n.nodeName}:\n  Error: ${msg}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: sections.join("\n\n") }],
      };
    }
  );

  server.registerTool(
    "read_log",
    {
      description:
        "Read RabbitMQ log file content from a node. Returns the last N lines (tail mode) by default. Node names match the `node` field from get_queue, get_overview, and list_connections tools.",
      inputSchema: z.object({
        node: z
          .string()
          .describe(
            'RabbitMQ node name (e.g. "rabbit@RMQ-APP1A-P01")'
          ),
        file: z
          .string()
          .optional()
          .describe(
            "Log file name. Defaults to the current log for the node (e.g. rabbit@RMQ-APP1A-P01.log). Use list_log_files to see available files."
          ),
        tail: z
          .number()
          .min(1)
          .max(5000)
          .default(100)
          .optional()
          .describe("Number of lines to read from end of file (default 100, max 5000)"),
        level: z
          .enum(["error", "warning", "info", "notice"])
          .optional()
          .describe("Filter to only show entries at this log level"),
      }),
    },
    async ({ node: nodeName, file, tail, level }) => {
      const nodeConfig = findNode(config, nodeName);
      if (!nodeConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown node "${nodeName}". Configured nodes:\n${nodeList(config)}`,
            },
          ],
        };
      }

      const fileName = file ?? currentLogName(nodeName);
      const lineCount = tail ?? 100;

      try {
        const text = await reader.tailFile(nodeConfig, fileName, lineCount);

        if (level) {
          const entries = parseLogLines(text);
          const filtered = filterByLevel(entries, level);
          if (filtered.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No [${level}] entries found in the last ${lineCount} lines of ${fileName} on ${nodeName}.`,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `${nodeName} — ${fileName} (${filtered.length} ${level} entries from last ${lineCount} lines):\n\n${formatEntries(filtered)}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `${nodeName} — ${fileName} (last ${lineCount} lines):\n\n${text}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("ENOENT") ||
          msg.includes("cannot find") ||
          msg.includes("The system cannot find")
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `File "${fileName}" not found on ${nodeName}. Use list_log_files to see available files.`,
              },
            ],
          };
        }
        return {
          content: [
            { type: "text" as const, text: `Error reading log: ${msg}` },
          ],
        };
      }
    }
  );

  server.registerTool(
    "search_logs",
    {
      description:
        "Search RabbitMQ log files for a text pattern or regex. Searches the current log by default; optionally includes rotated logs. Node names match the `node` field from get_queue, get_overview, and list_connections tools.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe("Text or regex pattern to search for"),
        node: z
          .string()
          .optional()
          .describe(
            'RabbitMQ node name. Omit to search all configured nodes.'
          ),
        includeRotated: z
          .boolean()
          .default(false)
          .optional()
          .describe(
            "Include rotated log files (.log.0, .log.1, etc.). Default false."
          ),
        maxRotated: z
          .number()
          .min(1)
          .max(10)
          .default(3)
          .optional()
          .describe(
            "Maximum number of rotated files to search (default 3, max 10). Only used when includeRotated is true."
          ),
        level: z
          .enum(["error", "warning", "info", "notice"])
          .optional()
          .describe("Filter results to this log level"),
        maxResults: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .optional()
          .describe("Maximum number of matching entries to return (default 50, max 200)"),
      }),
    },
    async ({
      pattern,
      node: nodeName,
      includeRotated,
      maxRotated,
      level,
      maxResults,
    }) => {
      const nodes = nodeName
        ? [findNode(config, nodeName)].filter(
            (n): n is LogNodeConfig => n !== undefined
          )
        : config.nodes;

      if (nodeName && nodes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown node "${nodeName}". Configured nodes:\n${nodeList(config)}`,
            },
          ],
        };
      }

      const limit = maxResults ?? 50;
      const sections: string[] = [];
      let totalMatches = 0;

      for (const nodeConf of nodes) {
        if (totalMatches >= limit) break;

        // Build list of files to search: current log first, then rotated
        const filesToSearch: string[] = [currentLogName(nodeConf.nodeName)];
        if (includeRotated) {
          const rotatedCount = maxRotated ?? 3;
          for (let i = 0; i < rotatedCount; i++) {
            filesToSearch.push(`${currentLogName(nodeConf.nodeName)}.${i}`);
          }
        }

        const nodeResults: string[] = [];
        for (const fileName of filesToSearch) {
          if (totalMatches >= limit) break;

          try {
            const text = await reader.readFile(nodeConf, fileName);
            let entries = parseLogLines(text);
            if (level) entries = filterByLevel(entries, level);
            let matches = searchEntries(entries, pattern);

            const remaining = limit - totalMatches;
            if (matches.length > remaining) {
              matches = matches.slice(-remaining); // Keep most recent
            }

            if (matches.length > 0) {
              nodeResults.push(
                `  ${fileName} (${matches.length} matches):\n${formatEntries(matches)}`
              );
              totalMatches += matches.length;
            }
          } catch {
            // File doesn't exist (rotated file may not be present) — skip silently
          }
        }

        if (nodeResults.length > 0) {
          sections.push(`${nodeConf.nodeName}:\n${nodeResults.join("\n\n")}`);
        }
      }

      if (sections.length === 0) {
        const scope = nodeName ? `on ${nodeName}` : "across all nodes";
        return {
          content: [
            {
              type: "text" as const,
              text: `No matches for "${pattern}" ${scope}.`,
            },
          ],
        };
      }

      const header = `Found ${totalMatches} match${totalMatches === 1 ? "" : "es"} for "${pattern}":\n\n`;
      return {
        content: [
          { type: "text" as const, text: header + sections.join("\n\n") },
        ],
      };
    }
  );
}
