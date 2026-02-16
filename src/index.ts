#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RabbitMQClient } from "./rabbitmq-client.js";
import type { RabbitMQConfig } from "./types.js";
import { registerOverviewTools } from "./tools/overview.js";
import { registerQueueTools } from "./tools/queues.js";
import { registerExchangeTools } from "./tools/exchanges.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerConnectionTools } from "./tools/connections.js";
import { registerMassTransitTools } from "./tools/masstransit.js";

function getConfig(): RabbitMQConfig {
  const host = process.env.RABBITMQ_HOST;
  if (!host) {
    console.error("RABBITMQ_HOST environment variable is required");
    process.exit(1);
  }

  const username = process.env.RABBITMQ_USERNAME;
  if (!username) {
    console.error("RABBITMQ_USERNAME environment variable is required");
    process.exit(1);
  }

  const password = process.env.RABBITMQ_PASSWORD;
  if (!password) {
    console.error("RABBITMQ_PASSWORD environment variable is required");
    process.exit(1);
  }

  const allowMutative =
    process.env.ALLOW_MUTATIVE_TOOLS === "true" ||
    process.argv.includes("--allow-mutative-tools");

  return {
    host,
    port: parseInt(process.env.RABBITMQ_PORT ?? "15672", 10),
    username,
    password,
    vhost: process.env.RABBITMQ_VHOST ?? "/",
    ssl: process.env.RABBITMQ_SSL === "true",
    allowMutativeTools: allowMutative,
  };
}

async function main() {
  const config = getConfig();
  const client = new RabbitMQClient(config);

  const server = new McpServer({
    name: "rabbitmq-masstransit",
    version: "1.0.0",
  });

  // Register all tools
  registerOverviewTools(server, client);
  registerQueueTools(server, client, config.allowMutativeTools);
  registerExchangeTools(server, client);
  registerMessageTools(server, client, config.allowMutativeTools);
  registerConnectionTools(server, client);
  registerMassTransitTools(server, client, config.allowMutativeTools);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `RabbitMQ MassTransit MCP server running (${config.host}:${config.port}, vhost: ${config.vhost}, mutative tools: ${config.allowMutativeTools ? "enabled" : "disabled"})`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
