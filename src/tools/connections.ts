import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RabbitMQClient } from "../rabbitmq-client.js";

export function registerConnectionTools(
  server: McpServer,
  client: RabbitMQClient
) {
  server.registerTool(
    "list_connections",
    {
      description: "List active RabbitMQ connections with client info, state, and channel count.",
      inputSchema: z.object({}),
    },
    async () => {
      const connections = await client.listConnections();

      if (connections.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No active connections." }],
        };
      }

      const lines = [`Active connections: ${connections.length}\n`];
      for (const c of connections) {
        const clientProps = c.client_properties ?? {};
        const product =
          (clientProps.product as string) ??
          (clientProps.connection_name as string) ??
          "unknown";
        lines.push(
          `${c.name}`,
          `  User: ${c.user} | Vhost: ${c.vhost} | State: ${c.state}`,
          `  Channels: ${c.channels} | Client: ${product}`,
          `  From: ${c.peer_host}:${c.peer_port} → ${c.host}:${c.port}`,
          `  Connected: ${new Date(c.connected_at).toISOString()}`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "list_consumers",
    {
      description: "List active consumers with their queue assignments, prefetch, and connection info.",
      inputSchema: z.object({
        vhost: z.string().optional().describe("Filter by vhost"),
      }),
    },
    async ({ vhost }) => {
      const consumers = await client.listConsumers(vhost);

      if (consumers.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No active consumers." }],
        };
      }

      const lines = [`Active consumers: ${consumers.length}\n`];
      for (const c of consumers) {
        lines.push(
          `Queue: ${c.queue.name}`,
          `  Tag: ${c.consumer_tag}`,
          `  Connection: ${c.channel_details.connection_name}`,
          `  User: ${c.channel_details.user} | Prefetch: ${c.prefetch_count}`,
          `  Ack Required: ${c.ack_required} | Active: ${c.active}`,
          ""
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
