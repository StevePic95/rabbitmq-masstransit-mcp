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

/**
 * Parse fault info from MT-Fault-* headers that MassTransit adds
 * when moving a message to the _error queue.
 */
export function parseFaultFromHeaders(
  headers: Record<string, unknown>
): MassTransitFault | null {
  const reason = headers["MT-Reason"] as string | undefined;
  const exceptionType = headers["MT-Fault-ExceptionType"] as string | undefined;
  const faultMessage = headers["MT-Fault-Message"] as string | undefined;

  if (!reason && !exceptionType) return null;

  return {
    faultedMessageId: undefined,
    timestamp: headers["MT-Fault-Timestamp"] as string | undefined,
    consumerType: headers["MT-Fault-ConsumerType"] as string | undefined,
    inputAddress: headers["MT-Fault-InputAddress"] as string | undefined,
    messageType: headers["MT-Fault-MessageType"] as string | undefined,
    retryCount: headers["MT-Fault-RetryCount"] as number | undefined,
    reason: reason,
    exceptions: exceptionType
      ? [
          {
            exceptionType,
            message: faultMessage,
            stackTrace: headers["MT-Fault-StackTrace"] as string | undefined,
          },
        ]
      : undefined,
    host: {
      machineName: headers["MT-Host-MachineName"] as string | undefined,
      processName: headers["MT-Host-ProcessName"] as string | undefined,
      processId: headers["MT-Host-ProcessId"] as number | undefined,
      assembly: headers["MT-Host-Assembly"] as string | undefined,
      assemblyVersion: headers["MT-Host-AssemblyVersion"] as string | undefined,
      frameworkVersion: headers["MT-Host-FrameworkVersion"] as string | undefined,
      massTransitVersion: headers["MT-Host-MassTransitVersion"] as string | undefined,
      operatingSystemVersion: headers["MT-Host-OperatingSystemVersion"] as string | undefined,
    },
  };
}

export function parseFault(payload: string): MassTransitFault | null {
  try {
    const envelope = JSON.parse(payload) as MassTransitEnvelope;
    if (!envelope.message) return null;

    const msg = envelope.message;
    // MassTransit Fault<T> messages have an exceptions array in the message payload
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
  const headers = msg.properties.headers ?? {};
  const headerFault = parseFaultFromHeaders(headers);
  const bodyFault = parseFault(msg.payload);
  const envelope = parseEnvelope(msg.payload);

  // Prefer header-based fault info (this is where MassTransit puts it on _error queues)
  if (headerFault) {
    const ex = headerFault.exceptions?.[0];
    const messageType =
      headerFault.messageType ?? (envelope?.messageType
        ? envelope.messageType.map(getMessageTypeName).join(", ")
        : "unknown");
    const host = headerFault.host;
    const hostInfo = host
      ? `${host.machineName ?? "unknown"} / ${host.processName ?? "unknown"} (PID ${host.processId ?? "?"})`
      : "unknown";

    const lines = [
      `Message ${index + 1}:`,
      `  Faulted: ${headerFault.timestamp ?? "unknown"}`,
      `  Reason: ${headerFault.reason ?? "fault"}`,
      `  Message Type: ${messageType}`,
    ];

    if (headerFault.consumerType) {
      lines.push(`  Consumer: ${headerFault.consumerType}`);
    }

    if (ex) {
      lines.push(`  Exception: ${ex.exceptionType ?? "unknown"} - "${ex.message ?? "unknown"}"`);
    }

    if (headerFault.retryCount !== undefined) {
      lines.push(`  Retry Count: ${headerFault.retryCount}`);
    }

    if (ex?.stackTrace) {
      const stackLines = ex.stackTrace.split("\n").slice(0, 8);
      lines.push(`  Stack Trace:\n${stackLines.map((l) => `    ${l.trim()}`).join("\n")}`);
    }

    // Show the original message payload from the body
    if (envelope?.message) {
      const payloadStr = JSON.stringify(envelope.message, null, 2);
      const truncated =
        payloadStr.length > 500
          ? payloadStr.slice(0, 500) + "\n    ... (truncated)"
          : payloadStr;
      lines.push(`  Original Payload: ${truncated}`);
    }

    lines.push(`  Source Host: ${hostInfo}`);

    if (host?.assembly && host?.assemblyVersion) {
      lines.push(`  Assembly: ${host.assembly} v${host.assemblyVersion} (.NET ${host.frameworkVersion ?? "?"})`);
    }

    return lines.join("\n");
  }

  // Fallback: body-based Fault<T> envelope parsing
  if (bodyFault) {
    const ex = bodyFault.exceptions?.[0];
    const messageTypes = envelope?.messageType
      ? envelope.messageType.map(getMessageTypeName)
      : [];
    const host = bodyFault.host;
    const hostInfo = host
      ? `${host.machineName ?? "unknown"} / ${host.processName ?? "unknown"} (PID ${host.processId ?? "?"})`
      : "unknown";

    const lines = [
      `Message ${index + 1}:`,
      `  Faulted: ${bodyFault.timestamp ?? "unknown"}`,
      `  Original MessageId: ${bodyFault.faultedMessageId ?? "unknown"}`,
      `  Message Type: ${messageTypes.length > 0 ? messageTypes.join(", ") : "unknown"}`,
      `  Exception: ${ex?.exceptionType ?? "unknown"} - "${ex?.message ?? "unknown"}"`,
    ];

    if (ex?.stackTrace) {
      const stackLines = ex.stackTrace.split("\n").slice(0, 8);
      lines.push(`  Stack Trace:\n${stackLines.map((l) => `    ${l.trim()}`).join("\n")}`);
    }

    if (bodyFault.message) {
      const payloadStr = JSON.stringify(bodyFault.message, null, 2);
      const truncated =
        payloadStr.length > 500
          ? payloadStr.slice(0, 500) + "\n    ... (truncated)"
          : payloadStr;
      lines.push(`  Original Payload: ${truncated}`);
    }

    lines.push(`  Source Host: ${hostInfo}`);
    return lines.join("\n");
  }

  // Fallback: plain MassTransit envelope (no fault info found)
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
