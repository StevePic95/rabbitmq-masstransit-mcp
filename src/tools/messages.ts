import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RabbitMQClient } from "../rabbitmq-client.js";
import { parseEnvelope, getMessageTypeName } from "../masstransit.js";

export function registerMessageTools(
  server: McpServer,
  client: RabbitMQClient,
  allowMutative: boolean
) {
  server.registerTool(
    "peek_messages",
    {
      description:
        "Browse messages in a queue without consuming them (non-destructive). Parses MassTransit envelopes when detected.",
      inputSchema: z.object({
        queue: z.string().describe("Queue name to peek"),
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
            { type: "text" as const, text: `Queue "${queue}" is empty.` },
          ],
        };
      }

      const lines = [`Queue: ${queue} (${messages.length} message(s) peeked)\n`];

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const envelope = parseEnvelope(msg.payload);

        lines.push(`--- Message ${i + 1} ---`);

        if (envelope) {
          const types = envelope.messageType
            ? envelope.messageType.map(getMessageTypeName)
            : [];
          lines.push(
            `MessageId: ${envelope.messageId ?? "unknown"}`,
            `Sent: ${envelope.sentTime ?? "unknown"}`,
            `Type: ${types.length > 0 ? types.join(", ") : "unknown"}`
          );
          if (envelope.correlationId) {
            lines.push(`CorrelationId: ${envelope.correlationId}`);
          }
          if (envelope.conversationId) {
            lines.push(`ConversationId: ${envelope.conversationId}`);
          }
          const payloadStr = JSON.stringify(envelope.message ?? {}, null, 2);
          lines.push(
            `Payload:`,
            payloadStr.length > 1000
              ? payloadStr.slice(0, 1000) + "\n... (truncated)"
              : payloadStr
          );
        } else {
          lines.push(
            `Exchange: ${msg.exchange}`,
            `Routing Key: ${msg.routing_key}`,
            `Content Type: ${msg.properties.content_type ?? "unknown"}`,
            `Payload:`,
            msg.payload.length > 1000
              ? msg.payload.slice(0, 1000) + "\n... (truncated)"
              : msg.payload
          );
        }

        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  if (allowMutative) {
    server.registerTool(
      "publish_message",
      {
        description:
          "Publish a message to an exchange with a routing key. The message is sent with MassTransit-compatible content type.",
        inputSchema: z.object({
          exchange: z.string().describe("Exchange to publish to"),
          routingKey: z.string().describe("Routing key for the message"),
          payload: z.string().describe("Message payload (JSON string)"),
          contentType: z
            .string()
            .optional()
            .describe(
              "Content type header (default: application/vnd.masstransit+json)"
            ),
          vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
        }),
      },
      async ({ exchange, routingKey, payload, contentType, vhost }) => {
        const properties: Record<string, unknown> = {};
        if (contentType) {
          properties.content_type = contentType;
        }

        const result = await client.publishMessage(
          exchange,
          routingKey,
          payload,
          properties,
          vhost
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.routed
                ? `Message published to exchange "${exchange}" with routing key "${routingKey}" — routed successfully.`
                : `Message published to exchange "${exchange}" with routing key "${routingKey}" — WARNING: message was NOT routed to any queue.`,
            },
          ],
        };
      }
    );

    server.registerTool(
      "move_messages",
      {
        description:
          "Move messages from one queue to another by consuming from source and publishing to destination exchange. DESTRUCTIVE — removes messages from source queue.",
        inputSchema: z.object({
          sourceQueue: z.string().describe("Source queue to consume from"),
          destinationExchange: z
            .string()
            .describe("Destination exchange to publish to"),
          routingKey: z
            .string()
            .optional()
            .describe("Routing key for destination (default: destination exchange name)"),
          count: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Number of messages to move (default: 1, max: 100)"),
          vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ sourceQueue, destinationExchange, routingKey, count, vhost }) => {
        const moveCount = count ?? 1;
        const messages = await client.consumeMessages(
          sourceQueue,
          moveCount,
          vhost
        );

        if (messages.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Source queue "${sourceQueue}" is empty — nothing to move.`,
              },
            ],
          };
        }

        let moved = 0;
        for (const msg of messages) {
          const rk = routingKey ?? destinationExchange;
          await client.publishMessage(
            destinationExchange,
            rk,
            msg.payload,
            {
              content_type:
                msg.properties.content_type ??
                "application/vnd.masstransit+json",
              headers: msg.properties.headers,
              message_id: msg.properties.message_id,
              correlation_id: msg.properties.correlation_id,
            },
            vhost
          );
          moved++;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Moved ${moved} message(s) from "${sourceQueue}" to exchange "${destinationExchange}".`,
            },
          ],
        };
      }
    );
  }
}
