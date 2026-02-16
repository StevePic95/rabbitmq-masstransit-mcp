import type {
  MassTransitEnvelope,
  MassTransitFault,
  ParsedFaultMessage,
  PeekedMessage,
} from "./types.js";

const ERROR_SUFFIX = "_error";
const SKIPPED_SUFFIX = "_skipped";

export function isErrorQueue(name: string): boolean {
  return name.endsWith(ERROR_SUFFIX);
}

export function isSkippedQueue(name: string): boolean {
  return name.endsWith(SKIPPED_SUFFIX);
}

export function getSourceQueue(errorQueueName: string): string {
  if (errorQueueName.endsWith(ERROR_SUFFIX)) {
    return errorQueueName.slice(0, -ERROR_SUFFIX.length);
  }
  if (errorQueueName.endsWith(SKIPPED_SUFFIX)) {
    return errorQueueName.slice(0, -SKIPPED_SUFFIX.length);
  }
  return errorQueueName;
}

/**
 * Convert MassTransit message type URN to readable name.
 * e.g. "urn:message:MyApp.Messages:OrderSubmitted" -> "MyApp.Messages.OrderSubmitted"
 */
export function getMessageTypeName(urn: string): string {
  if (!urn.startsWith("urn:message:")) return urn;
  return urn.slice("urn:message:".length).replace(/:/g, ".");
}

export function parseEnvelope(
  payload: string
): MassTransitEnvelope | null {
  try {
    const parsed = JSON.parse(payload);
    if (parsed && (parsed.messageType || parsed.messageId || parsed.message)) {
      return parsed as MassTransitEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseFault(payload: string): MassTransitFault | null {
  try {
    const envelope = JSON.parse(payload) as MassTransitEnvelope;
    if (!envelope.message) return null;

    const msg = envelope.message;
    // MassTransit faults have an exceptions array in the message payload
    if (
      msg.exceptions &&
      Array.isArray(msg.exceptions) &&
      msg.exceptions.length > 0
    ) {
      return {
        faultId: msg.faultId as string | undefined,
        faultedMessageId: msg.faultedMessageId as string | undefined,
        timestamp: envelope.sentTime ?? (msg.timestamp as string | undefined),
        exceptions: msg.exceptions as MassTransitFault["exceptions"],
        message: msg.message as Record<string, unknown> | undefined,
        host: envelope.host,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function formatFaultMessage(
  msg: PeekedMessage,
  index: number
): string {
  const fault = parseFault(msg.payload);
  const envelope = parseEnvelope(msg.payload);

  if (fault) {
    const ex = fault.exceptions?.[0];
    const messageTypes = envelope?.messageType
      ? envelope.messageType.map(getMessageTypeName)
      : [];
    const host = fault.host;
    const hostInfo = host
      ? `${host.machineName ?? "unknown"} / ${host.processName ?? "unknown"} (PID ${host.processId ?? "?"})`
      : "unknown";

    const lines = [
      `Message ${index + 1}:`,
      `  Faulted: ${fault.timestamp ?? "unknown"}`,
      `  Original MessageId: ${fault.faultedMessageId ?? "unknown"}`,
      `  Message Type: ${messageTypes.length > 0 ? messageTypes.join(", ") : "unknown"}`,
      `  Exception: ${ex?.exceptionType ?? "unknown"} - "${ex?.message ?? "unknown"}"`,
    ];

    if (ex?.stackTrace) {
      const stackLines = ex.stackTrace.split("\n").slice(0, 5);
      lines.push(`  Stack Trace:\n${stackLines.map((l) => `    ${l.trim()}`).join("\n")}`);
    }

    if (fault.message) {
      const payloadStr = JSON.stringify(fault.message, null, 2);
      const truncated =
        payloadStr.length > 500
          ? payloadStr.slice(0, 500) + "\n    ... (truncated)"
          : payloadStr;
      lines.push(`  Original Payload: ${truncated}`);
    }

    lines.push(`  Source Host: ${hostInfo}`);
    return lines.join("\n");
  }

  // Fallback for non-fault messages in error queues
  if (envelope) {
    const messageTypes = envelope.messageType
      ? envelope.messageType.map(getMessageTypeName)
      : [];
    return [
      `Message ${index + 1}:`,
      `  MessageId: ${envelope.messageId ?? "unknown"}`,
      `  Sent: ${envelope.sentTime ?? "unknown"}`,
      `  Message Type: ${messageTypes.length > 0 ? messageTypes.join(", ") : "unknown"}`,
      `  Payload: ${JSON.stringify(envelope.message ?? {}, null, 2).slice(0, 500)}`,
    ].join("\n");
  }

  // Raw message fallback
  return [
    `Message ${index + 1}:`,
    `  Exchange: ${msg.exchange}`,
    `  Routing Key: ${msg.routing_key}`,
    `  Payload: ${msg.payload.slice(0, 500)}`,
  ].join("\n");
}
