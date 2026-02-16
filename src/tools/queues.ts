import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RabbitMQClient } from "../rabbitmq-client.js";

export function registerQueueTools(
  server: McpServer,
  client: RabbitMQClient,
  allowMutative: boolean
) {
  server.registerTool(
    "list_queues",
    {
      description:
        "List queues with message depth, consumer count, and rates. Filter by vhost and name pattern.",
      inputSchema: z.object({
        vhost: z.string().optional().describe("Filter by vhost (default: configured vhost)"),
        namePattern: z
          .string()
          .optional()
          .describe("Filter queue names containing this string (case-insensitive)"),
        sortBy: z
          .enum(["name", "messages", "consumers"])
          .optional()
          .describe("Sort results (default: name)"),
      }),
    },
    async ({ vhost, namePattern, sortBy }) => {
      let queues = await client.listQueues(vhost);

      if (namePattern) {
        const pattern = namePattern.toLowerCase();
        queues = queues.filter((q) =>
          q.name.toLowerCase().includes(pattern)
        );
      }

      const sort = sortBy ?? "name";
      queues.sort((a, b) => {
        if (sort === "messages") return (b.messages ?? 0) - (a.messages ?? 0);
        if (sort === "consumers") return (b.consumers ?? 0) - (a.consumers ?? 0);
        return a.name.localeCompare(b.name);
      });

      if (queues.length === 0) {
        return { content: [{ type: "text" as const, text: "No queues found matching criteria." }] };
      }

      const lines = [`Found ${queues.length} queue(s):\n`];
      for (const q of queues) {
        const rate = q.message_stats?.publish_details?.rate ?? 0;
        lines.push(
          `${q.name}`,
          `  Messages: ${q.messages} (ready: ${q.messages_ready}, unacked: ${q.messages_unacknowledged})`,
          `  Consumers: ${q.consumers} | State: ${q.state} | Publish rate: ${rate}/s`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "get_queue",
    {
      description:
        "Get detailed stats for a specific queue: depth, rates, consumers, memory, policy, arguments.",
      inputSchema: z.object({
        name: z.string().describe("Queue name"),
        vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
      }),
    },
    async ({ name, vhost }) => {
      const q = await client.getQueue(name, vhost);

      const lines = [
        `Queue: ${q.name}`,
        `Vhost: ${q.vhost}`,
        `State: ${q.state}`,
        `Node: ${q.node ?? "unknown"}`,
        "",
        "Messages:",
        `  Total: ${q.messages}`,
        `  Ready: ${q.messages_ready}`,
        `  Unacknowledged: ${q.messages_unacknowledged}`,
        "",
        `Consumers: ${q.consumers}`,
        `Memory: ${(q.memory / 1024).toFixed(1)} KB`,
        `Durable: ${q.durable}`,
        `Auto-delete: ${q.auto_delete}`,
        `Exclusive: ${q.exclusive}`,
      ];

      if (q.policy) lines.push(`Policy: ${q.policy}`);

      if (q.message_stats) {
        const stats = q.message_stats;
        lines.push(
          "",
          "Rates:",
          `  Publish: ${stats.publish_details?.rate ?? 0}/s`,
          `  Deliver: ${stats.deliver_details?.rate ?? 0}/s`,
          `  Ack: ${stats.ack_details?.rate ?? 0}/s`
        );
      }

      if (q.arguments && Object.keys(q.arguments).length > 0) {
        lines.push("", "Arguments:", JSON.stringify(q.arguments, null, 2));
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  if (allowMutative) {
    server.registerTool(
      "purge_queue",
      {
        description: "Purge all messages from a queue. DESTRUCTIVE — messages cannot be recovered.",
        inputSchema: z.object({
          name: z.string().describe("Queue name to purge"),
          vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ name, vhost }) => {
        const q = await client.getQueue(name, vhost);
        const count = q.messages;
        await client.purgeQueue(name, vhost);
        return {
          content: [
            {
              type: "text" as const,
              text: `Purged queue "${name}" — ${count} message(s) removed.`,
            },
          ],
        };
      }
    );

    server.registerTool(
      "delete_queue",
      {
        description: "Delete a queue entirely. DESTRUCTIVE — queue and all messages will be lost.",
        inputSchema: z.object({
          name: z.string().describe("Queue name to delete"),
          vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ name, vhost }) => {
        await client.deleteQueue(name, vhost);
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted queue "${name}".`,
            },
          ],
        };
      }
    );
  }
}
