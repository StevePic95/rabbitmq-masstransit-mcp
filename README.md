# RabbitMQ MassTransit MCP Server

An MCP (Model Context Protocol) server for RabbitMQ with **MassTransit intelligence** — error queue parsing, fault analysis, and message republishing.

Built for teams debugging async messaging issues across .NET microservices. Goes beyond basic queue management by understanding MassTransit conventions: `_error`/`_skipped` queues, the message envelope format, and fault message parsing.

## Features

- **18 tools** for complete RabbitMQ management via Claude Code
- **MassTransit-aware**: Automatically detects and parses `_error`/`_skipped` queues, fault envelopes, and message type URNs
- **Parsed error output**: Exception types, messages, stack traces, consumer types, retry counts, and original payloads — extracted from `MT-Fault-*` message headers
- **Republish from error**: The killer feature — fetch faulted messages and republish them for reprocessing
- **Safe defaults**: Mutative tools disabled by default, two-step confirmation for destructive operations

## Quickstart

**1. Add to your Claude Code config** (`~/.claude.json` or project `.claude.json`):

```json
{
  "mcpServers": {
    "rabbitmq": {
      "command": "npx",
      "args": ["-y", "@stevepic95/rabbitmq-masstransit-mcp"],
      "env": {
        "RABBITMQ_HOST": "your-rabbitmq-host",
        "RABBITMQ_USERNAME": "your-username",
        "RABBITMQ_PASSWORD": "your-password"
      }
    }
  }
}
```

**2. Restart Claude Code** to load the new MCP server.

**3. Start using it.** Ask Claude things like:
- *"Are there any error queues with messages?"*
- *"Show me the faults in the submit-order error queue"*
- *"What queues have no consumers?"*
- *"How many messages are in the report queue?"*

That's it. The 13 read-only tools are available immediately — no flags needed.

> To enable write operations (purge, delete, publish, republish), set `"ALLOW_MUTATIVE_TOOLS": "true"` in the env config.

## Installation

```bash
npx @stevepic95/rabbitmq-masstransit-mcp
```

### Claude Code Configuration

Add to your `.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "rabbitmq": {
      "command": "npx",
      "args": ["-y", "@stevepic95/rabbitmq-masstransit-mcp"],
      "env": {
        "RABBITMQ_HOST": "your-rabbitmq-host",
        "RABBITMQ_PORT": "15672",
        "RABBITMQ_USERNAME": "your-username",
        "RABBITMQ_PASSWORD": "your-password",
        "RABBITMQ_VHOST": "/",
        "RABBITMQ_SSL": "false",
        "ALLOW_MUTATIVE_TOOLS": "false"
      }
    }
  }
}
```

For local development:

```json
{
  "mcpServers": {
    "rabbitmq": {
      "command": "node",
      "args": ["/path/to/rabbitmq-masstransit-mcp/dist/index.js"],
      "env": {
        "RABBITMQ_HOST": "localhost",
        "RABBITMQ_USERNAME": "guest",
        "RABBITMQ_PASSWORD": "guest"
      }
    }
  }
}
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RABBITMQ_HOST` | Yes | — | RabbitMQ Management API hostname |
| `RABBITMQ_PORT` | No | `15672` | Management API port |
| `RABBITMQ_USERNAME` | Yes | — | Authentication username |
| `RABBITMQ_PASSWORD` | Yes | — | Authentication password |
| `RABBITMQ_VHOST` | No | `/` | Default virtual host |
| `RABBITMQ_SSL` | No | `false` | Use HTTPS for Management API |
| `ALLOW_MUTATIVE_TOOLS` | No | `false` | Enable mutative tools (purge, delete, publish, republish, move) |

You can also enable mutative tools via CLI flag: `--allow-mutative-tools`

## Tools

### Read-Only (13 tools) — Always available

| Tool | Description |
|------|-------------|
| `get_overview` | Cluster stats: queue totals, connection counts, message rates |
| `list_queues` | List queues with depth, consumer count, rates. Filter by vhost, name pattern |
| `get_queue` | Detailed queue stats: depth, rates, consumers, memory, policy |
| `list_exchanges` | List exchanges. Filter by vhost, type |
| `get_exchange` | Exchange details and bindings |
| `list_bindings` | List bindings for a queue or exchange |
| `list_connections` | Active connections with client info |
| `list_consumers` | Active consumers with queue assignments |
| `peek_messages` | Browse messages without consuming (non-destructive) |
| `list_error_queues` | Find all `_error` queues with message counts |
| `list_skipped_queues` | Find all `_skipped` queues with message counts |
| `peek_errors` | Browse error queue messages with **parsed fault details** |
| `get_queue_health` | Quick health check: no consumers, growing depth, high error counts |

### Mutative (5 tools) — Require `ALLOW_MUTATIVE_TOOLS=true`

| Tool | Description |
|------|-------------|
| `purge_queue` | Purge all messages from a queue |
| `delete_queue` | Delete a queue |
| `publish_message` | Publish a message to an exchange |
| `republish_from_error` | Republish faulted messages from `_error` queue to original exchange |
| `move_messages` | Move messages from one queue to another |

## MassTransit Intelligence

### Error Queue Parsing

`peek_errors` doesn't just dump raw JSON — it reads `MT-Fault-*` headers that MassTransit attaches when moving messages to error queues, giving you everything you need to debug the failure:

```
Queue: submit-order_error (3 messages)

Message 1:
  Faulted: 2026-02-15T14:30:05Z
  Reason: fault
  Message Type: MyApp.Messages.OrderSubmitted
  Consumer: MyApp.Consumers.SubmitOrderConsumer
  Exception: Microsoft.Data.SqlClient.SqlException - "Arithmetic overflow error converting numeric to data type numeric."
  Retry Count: 5
  Stack Trace:
    at Microsoft.Data.SqlClient.TdsParser.ThrowExceptionAndWarning(...)
    at MyApp.Data.OrderRepository.GetFees(Int32 orderId) in /src/OrderRepository.cs:line 35
    at MyApp.Services.OrderService.Process(Int32 id) in /src/OrderService.cs:line 51
    at MyApp.Consumers.SubmitOrderConsumer.Consume(ConsumeContext`1 context) in /src/SubmitOrderConsumer.cs:line 11
  Original Payload: { "orderId": "abc-123", "amount": 99.99 }
  Source Host: order-service-swrm-app1b-p02 / order-service (PID 1)
  Assembly: order-service v1.0.3.0 (.NET 8.0.8)
```

### Republish from Error (Two-Step)

The highest-value tool for debugging. First call previews the messages:

```
> republish_from_error(errorQueue: "submit-order_error", count: 3)

Preview: 3 message(s) from "submit-order_error" ready to republish:
[... parsed fault details ...]

To republish these messages, call again with confirm=true and count=3.
```

Second call with `confirm: true` actually consumes and republishes:

```
> republish_from_error(errorQueue: "submit-order_error", count: 3, confirm: true)

Republished 3/3 message(s) from "submit-order_error".
```

### Queue Health Check

Quick overview of potential issues across all queues:

```
> get_queue_health()

⚠ Queues with NO consumers and messages (2):
  order-processing — 150 message(s)
  notification-sender — 42 message(s)

✗ Error queues with messages (3 queues, 89 total):
  submit-order_error — 45 message(s)
  payment-process_error — 32 message(s)
  email-send_error — 12 message(s)

△ High depth queues (>1000 messages, 1):
  analytics-events — 15234 message(s), 2 consumer(s)
```

## Requirements

- Node.js >= 18.0.0
- RabbitMQ with Management Plugin enabled (port 15672)

## License

MIT
