import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RabbitMQClient } from "../rabbitmq-client.js";
import {
  isErrorQueue,
  isSkippedQueue,
  getSourceQueue,
  formatFaultMessage,
  parseEnvelope,
  getMessageTypeName,
} from "../masstransit.js";

export function registerMassTransitTools(
  server: McpServer,
  client: RabbitMQClient,
  allowMutative: boolean
) {
  server.registerTool(
    "list_error_queues",
    {
      description:
        "Find all MassTransit _error queues with message counts. Helps identify services with unprocessed failures.",
      inputSchema: z.object({
        vhost: z.string().optional().describe("Filter by vhost"),
        nonEmpty: z
          .boolean()
          .optional()
          .describe("Only show queues with messages (default: true)"),
      }),
    },
    async ({ vhost, nonEmpty }) => {
      const queues = await client.listQueues(vhost);
      let errorQueues = queues.filter((q) => isErrorQueue(q.name));

      if (nonEmpty !== false) {
        errorQueues = errorQueues.filter((q) => q.messages > 0);
      }

      errorQueues.sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0));

      if (errorQueues.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: nonEmpty !== false
                ? "No _error queues with messages found."
                : "No _error queues found.",
            },
          ],
        };
      }

      const totalErrors = errorQueues.reduce(
        (sum, q) => sum + (q.messages ?? 0),
        0
      );
      const lines = [
        `Found ${errorQueues.length} _error queue(s) with ${totalErrors} total message(s):\n`,
      ];

      for (const q of errorQueues) {
        const source = getSourceQueue(q.name);
        lines.push(
          `${q.name}`,
          `  Messages: ${q.messages} | Source queue: ${source} | Consumers: ${q.consumers}`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "list_skipped_queues",
    {
      description:
        "Find all MassTransit _skipped queues with message counts. Skipped messages indicate routing or serialization issues.",
      inputSchema: z.object({
        vhost: z.string().optional().describe("Filter by vhost"),
        nonEmpty: z
          .boolean()
          .optional()
          .describe("Only show queues with messages (default: true)"),
      }),
    },
    async ({ vhost, nonEmpty }) => {
      const queues = await client.listQueues(vhost);
      let skippedQueues = queues.filter((q) => isSkippedQueue(q.name));

      if (nonEmpty !== false) {
        skippedQueues = skippedQueues.filter((q) => q.messages > 0);
      }

      skippedQueues.sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0));

      if (skippedQueues.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: nonEmpty !== false
                ? "No _skipped queues with messages found."
                : "No _skipped queues found.",
            },
          ],
        };
      }

      const totalSkipped = skippedQueues.reduce(
        (sum, q) => sum + (q.messages ?? 0),
        0
      );
      const lines = [
        `Found ${skippedQueues.length} _skipped queue(s) with ${totalSkipped} total message(s):\n`,
      ];

      for (const q of skippedQueues) {
        const source = getSourceQueue(q.name);
        lines.push(
          `${q.name}`,
          `  Messages: ${q.messages} | Source queue: ${source} | Consumers: ${q.consumers}`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "peek_errors",
    {
      description:
        "Browse error queue messages with parsed MassTransit fault details: exception type, message, stack trace, original payload, and source host.",
      inputSchema: z.object({
        queue: z
          .string()
          .describe('Error queue name (e.g., "submit-order_error")'),
        count: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Number of messages to peek (default: 5, max: 50)"),
        vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
      }),
    },
    async ({ queue, count, vhost }) => {
      const messages = await client.peekMessages(
        queue,
        count ?? 5,
        vhost
      );

      if (messages.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Queue "${queue}" is empty.`,
            },
          ],
        };
      }

      const lines = [`Queue: ${queue} (${messages.length} message(s))\n`];

      for (let i = 0; i < messages.length; i++) {
        lines.push(formatFaultMessage(messages[i], i));
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "get_queue_health",
    {
      description:
        "Quick health check: find queues with no consumers, growing depth, or high error counts. Identifies potential issues.",
      inputSchema: z.object({
        vhost: z.string().optional().describe("Filter by vhost"),
        minMessages: z
          .number()
          .int()
          .optional()
          .describe("Minimum messages to flag a queue (default: 1)"),
      }),
    },
    async ({ vhost, minMessages }) => {
      const queues = await client.listQueues(vhost);
      const threshold = minMessages ?? 1;

      const noConsumers = queues.filter(
        (q) =>
          q.consumers === 0 &&
          q.messages >= threshold &&
          !isErrorQueue(q.name) &&
          !isSkippedQueue(q.name)
      );

      const errorQueues = queues
        .filter((q) => isErrorQueue(q.name) && q.messages >= threshold)
        .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0));

      const skippedQueues = queues
        .filter((q) => isSkippedQueue(q.name) && q.messages >= threshold)
        .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0));

      const highDepth = queues
        .filter(
          (q) =>
            q.messages >= 1000 &&
            !isErrorQueue(q.name) &&
            !isSkippedQueue(q.name)
        )
        .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0));

      const lines: string[] = [];

      if (
        noConsumers.length === 0 &&
        errorQueues.length === 0 &&
        skippedQueues.length === 0 &&
        highDepth.length === 0
      ) {
        return {
          content: [
            { type: "text" as const, text: "All queues look healthy — no issues detected." },
          ],
        };
      }

      if (noConsumers.length > 0) {
        lines.push(
          `⚠ Queues with NO consumers and messages (${noConsumers.length}):`
        );
        for (const q of noConsumers) {
          lines.push(`  ${q.name} — ${q.messages} message(s)`);
        }
        lines.push("");
      }

      if (errorQueues.length > 0) {
        const total = errorQueues.reduce((s, q) => s + q.messages, 0);
        lines.push(
          `✗ Error queues with messages (${errorQueues.length} queues, ${total} total):`
        );
        for (const q of errorQueues) {
          lines.push(`  ${q.name} — ${q.messages} message(s)`);
        }
        lines.push("");
      }

      if (skippedQueues.length > 0) {
        const total = skippedQueues.reduce((s, q) => s + q.messages, 0);
        lines.push(
          `⊘ Skipped queues with messages (${skippedQueues.length} queues, ${total} total):`
        );
        for (const q of skippedQueues) {
          lines.push(`  ${q.name} — ${q.messages} message(s)`);
        }
        lines.push("");
      }

      if (highDepth.length > 0) {
        lines.push(
          `△ High depth queues (>1000 messages, ${highDepth.length}):`
        );
        for (const q of highDepth) {
          lines.push(
            `  ${q.name} — ${q.messages} message(s), ${q.consumers} consumer(s)`
          );
        }
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  if (allowMutative) {
    server.registerTool(
      "republish_from_error",
      {
        description:
          "Fetch messages from a MassTransit _error queue and republish them to their original exchange for reprocessing. Two-step: first call shows message details, second call with confirm=true executes the republish.",
        inputSchema: z.object({
          errorQueue: z
            .string()
            .describe('Error queue name (e.g., "submit-order_error")'),
          count: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe("Number of messages to republish (default: 1, max: 50)"),
          confirm: z
            .boolean()
            .optional()
            .describe(
              "Set to true to execute the republish. Without this, only previews messages."
            ),
          vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ errorQueue, count, confirm, vhost }) => {
        const peekCount = count ?? 1;

        if (!confirm) {
          // Preview mode — peek without consuming
          const messages = await client.peekMessages(
            errorQueue,
            peekCount,
            vhost
          );

          if (messages.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Queue "${errorQueue}" is empty — nothing to republish.`,
                },
              ],
            };
          }

          const lines = [
            `Preview: ${messages.length} message(s) from "${errorQueue}" ready to republish:\n`,
          ];

          for (let i = 0; i < messages.length; i++) {
            lines.push(formatFaultMessage(messages[i], i));
            lines.push("");
          }

          lines.push(
            "---",
            `To republish these messages, call again with confirm=true and count=${messages.length}.`
          );

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        // Confirm mode — consume and republish
        const messages = await client.consumeMessages(
          errorQueue,
          peekCount,
          vhost
        );

        if (messages.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Queue "${errorQueue}" is empty — nothing to republish.`,
              },
            ],
          };
        }

        let republished = 0;
        const errors: string[] = [];

        for (const msg of messages) {
          try {
            const envelope = parseEnvelope(msg.payload);
            let targetExchange: string;
            let routingKey: string;

            if (envelope?.destinationAddress) {
              // Extract exchange from MassTransit destination address
              // Format: rabbitmq://host/vhost/exchange-name
              const url = new URL(envelope.destinationAddress);
              const pathParts = url.pathname.split("/").filter(Boolean);
              targetExchange = pathParts[pathParts.length - 1] ?? "";
              routingKey = targetExchange;
            } else {
              // Fallback: derive from error queue name
              const sourceQueue = getSourceQueue(errorQueue);
              targetExchange = sourceQueue;
              routingKey = sourceQueue;
            }

            // Republish the original message content
            const payload = envelope?.message
              ? msg.payload // Keep the full envelope
              : msg.payload;

            await client.publishMessage(
              targetExchange,
              routingKey,
              payload,
              {
                content_type:
                  msg.properties.content_type ??
                  "application/vnd.masstransit+json",
                headers: msg.properties.headers,
                message_id: msg.properties.message_id,
              },
              vhost
            );
            republished++;
          } catch (err) {
            const errMsg =
              err instanceof Error ? err.message : String(err);
            errors.push(`Message ${republished + 1}: ${errMsg}`);
          }
        }

        const lines = [
          `Republished ${republished}/${messages.length} message(s) from "${errorQueue}".`,
        ];
        if (errors.length > 0) {
          lines.push("", "Errors:", ...errors);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }
    );
  }
}
