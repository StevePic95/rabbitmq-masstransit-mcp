import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RabbitMQClient } from "../rabbitmq-client.js";

export function registerOverviewTools(
  server: McpServer,
  client: RabbitMQClient
) {
  server.registerTool(
    "get_overview",
    {
      description:
        "Get RabbitMQ cluster overview: queue totals, connection counts, message rates, and version info",
      inputSchema: z.object({}),
    },
    async () => {
      const overview = await client.getOverview();
      const lines = [
        `Cluster: ${overview.cluster_name}`,
        `RabbitMQ: ${overview.rabbitmq_version} | Erlang: ${overview.erlang_version}`,
        `Node: ${overview.node}`,
        "",
        "Queue Totals:",
        `  Messages: ${overview.queue_totals.messages}`,
        `  Ready: ${overview.queue_totals.messages_ready}`,
        `  Unacknowledged: ${overview.queue_totals.messages_unacknowledged}`,
        "",
        "Object Totals:",
        `  Queues: ${overview.object_totals.queues}`,
        `  Exchanges: ${overview.object_totals.exchanges}`,
        `  Connections: ${overview.object_totals.connections}`,
        `  Channels: ${overview.object_totals.channels}`,
        `  Consumers: ${overview.object_totals.consumers}`,
      ];

      if (overview.message_stats) {
        const stats = overview.message_stats;
        lines.push(
          "",
          "Message Rates:",
          `  Publish: ${stats.publish_details?.rate ?? 0}/s`,
          `  Deliver: ${stats.deliver_details?.rate ?? 0}/s`,
          `  Ack: ${stats.ack_details?.rate ?? 0}/s`
        );
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
