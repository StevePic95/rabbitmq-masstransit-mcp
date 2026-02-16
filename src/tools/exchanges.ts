import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RabbitMQClient } from "../rabbitmq-client.js";

export function registerExchangeTools(
  server: McpServer,
  client: RabbitMQClient
) {
  server.registerTool(
    "list_exchanges",
    {
      description:
        "List exchanges with type and binding info. Filter by vhost, name pattern, or type.",
      inputSchema: z.object({
        vhost: z.string().optional().describe("Filter by vhost"),
        namePattern: z
          .string()
          .optional()
          .describe("Filter exchange names containing this string (case-insensitive)"),
        type: z
          .enum(["direct", "fanout", "topic", "headers"])
          .optional()
          .describe("Filter by exchange type"),
      }),
    },
    async ({ vhost, namePattern, type }) => {
      let exchanges = await client.listExchanges(vhost);

      if (namePattern) {
        const pattern = namePattern.toLowerCase();
        exchanges = exchanges.filter((e) =>
          e.name.toLowerCase().includes(pattern)
        );
      }

      if (type) {
        exchanges = exchanges.filter((e) => e.type === type);
      }

      // Filter out default empty-name exchange unless explicitly searched
      if (!namePattern) {
        exchanges = exchanges.filter((e) => e.name !== "");
      }

      exchanges.sort((a, b) => a.name.localeCompare(b.name));

      if (exchanges.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No exchanges found matching criteria." }],
        };
      }

      const lines = [`Found ${exchanges.length} exchange(s):\n`];
      for (const e of exchanges) {
        lines.push(
          `${e.name || "(default)"}`,
          `  Type: ${e.type} | Durable: ${e.durable} | Auto-delete: ${e.auto_delete} | Internal: ${e.internal}`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "get_exchange",
    {
      description: "Get exchange details and its bindings (both source and destination).",
      inputSchema: z.object({
        name: z.string().describe("Exchange name"),
        vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
      }),
    },
    async ({ name, vhost }) => {
      const exchange = await client.getExchange(name, vhost);
      const sourceBindings = await client.listBindingsForExchange(
        name,
        "source",
        vhost
      );
      const destBindings = await client.listBindingsForExchange(
        name,
        "destination",
        vhost
      );

      const lines = [
        `Exchange: ${exchange.name}`,
        `Vhost: ${exchange.vhost}`,
        `Type: ${exchange.type}`,
        `Durable: ${exchange.durable}`,
        `Auto-delete: ${exchange.auto_delete}`,
        `Internal: ${exchange.internal}`,
      ];

      if (sourceBindings.length > 0) {
        lines.push("", `Bindings (source → destination): ${sourceBindings.length}`);
        for (const b of sourceBindings) {
          lines.push(
            `  → ${b.destination_type} "${b.destination}" (routing_key: "${b.routing_key}")`
          );
        }
      }

      if (destBindings.length > 0) {
        lines.push("", `Bindings (incoming from): ${destBindings.length}`);
        for (const b of destBindings) {
          lines.push(
            `  ← exchange "${b.source}" (routing_key: "${b.routing_key}")`
          );
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "list_bindings",
    {
      description: "List bindings for a specific queue or exchange.",
      inputSchema: z.object({
        target: z.string().describe("Queue or exchange name"),
        targetType: z
          .enum(["queue", "exchange"])
          .describe("Whether the target is a queue or exchange"),
        vhost: z.string().optional().describe("Vhost (default: configured vhost)"),
      }),
    },
    async ({ target, targetType, vhost }) => {
      let bindings;
      if (targetType === "queue") {
        bindings = await client.listBindingsForQueue(target, vhost);
      } else {
        const source = await client.listBindingsForExchange(
          target,
          "source",
          vhost
        );
        const dest = await client.listBindingsForExchange(
          target,
          "destination",
          vhost
        );
        bindings = [...source, ...dest];
      }

      if (bindings.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No bindings found for ${targetType} "${target}".`,
            },
          ],
        };
      }

      const lines = [`Bindings for ${targetType} "${target}": ${bindings.length}\n`];
      for (const b of bindings) {
        lines.push(
          `Source: ${b.source || "(default)"} → Destination: ${b.destination} (${b.destination_type})`,
          `  Routing Key: "${b.routing_key}"`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
