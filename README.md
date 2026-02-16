# RabbitMQ MassTransit MCP Server

An MCP (Model Context Protocol) server for RabbitMQ with **MassTransit intelligence** — error queue parsing, fault analysis, and message republishing.

Built for teams debugging async messaging issues across .NET microservices. Goes beyond basic queue management by understanding MassTransit conventions: `_error`/`_skipped` queues, the message envelope format, and fault message parsing.

## Features

- **18 tools** for complete RabbitMQ management via Claude Code
- **MassTransit-aware**: Automatically detects and parses `_error`/`_skipped` queues, fault envelopes, and message type URNs
- **Parsed error output**: Exception types, messages, stack traces, and original payloads — not raw JSON dumps
- **Republish from error**: The killer feature — fetch faulted messages and republish them for reprocessing
- **Safe defaults**: Mutative tools disabled by default, two-step confirmation for destructive operations

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

`peek_errors` doesn't just dump raw JSON — it parses MassTransit fault envelopes into readable output:

```
Queue: submit-order_error (3 messages)

Message 1:
  Faulted: 2026-02-15T14:30:05Z
  Original MessageId: 5fdc0000-426e-001c-fcf9-08d9a30339e8
  Message Type: MyApp.Messages.OrderSubmitted
  Exception: System.InvalidOperationException - "Order validation failed"
  Stack Trace:
    at MyApp.Consumers.OrderConsumer.Consume(ConsumeContext`1 context)
    at MassTransit.Middleware.ConsumerMessageFilter`2.Send(...)
  Original Payload: { "orderId": "abc-123", ... }
  Source Host: WEBSERVER01 / OrderService (PID 12345)
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
