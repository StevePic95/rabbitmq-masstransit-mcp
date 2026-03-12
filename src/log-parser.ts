import type { LogEntry } from "./types.js";

const LOG_LINE_REGEX =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2}) \[(\w+)\] (<[\d.]+>) (.*)$/;

export function parseLogLines(text: string): LogEntry[] {
  const lines = text.split("\n");
  const entries: LogEntry[] = [];
  let current: LogEntry | null = null;

  for (const line of lines) {
    const match = line.match(LOG_LINE_REGEX);
    if (match) {
      if (current) entries.push(current);
      current = {
        timestamp: match[1],
        level: match[2],
        pid: match[3],
        message: match[4],
      };
    } else if (current && line.trim() !== "") {
      // Continuation line — append to current entry
      current.message += "\n" + line;
    }
  }
  if (current) entries.push(current);

  return entries;
}

export function filterByLevel(entries: LogEntry[], level: string): LogEntry[] {
  const normalized = level.toLowerCase();
  return entries.filter((e) => e.level.toLowerCase() === normalized);
}

export function searchEntries(entries: LogEntry[], pattern: string): LogEntry[] {
  let regex: RegExp | null = null;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    // Invalid regex — fall back to case-insensitive substring
  }

  return entries.filter((entry) => {
    const text = `${entry.timestamp} [${entry.level}] ${entry.pid} ${entry.message}`;
    if (regex) return regex.test(text);
    return text.toLowerCase().includes(pattern.toLowerCase());
  });
}

export function formatEntries(entries: LogEntry[]): string {
  return entries
    .map(
      (e) => `${e.timestamp} [${e.level}] ${e.pid} ${e.message}`
    )
    .join("\n");
}
