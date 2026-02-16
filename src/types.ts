export interface RabbitMQConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost: string;
  ssl: boolean;
  allowMutativeTools: boolean;
}

export interface QueueInfo {
  name: string;
  vhost: string;
  durable: boolean;
  auto_delete: boolean;
  exclusive: boolean;
  messages: number;
  messages_ready: number;
  messages_unacknowledged: number;
  consumers: number;
  state: string;
  memory: number;
  message_stats?: MessageStats;
  arguments?: Record<string, unknown>;
  policy?: string;
  node?: string;
}

export interface ExchangeInfo {
  name: string;
  vhost: string;
  type: string;
  durable: boolean;
  auto_delete: boolean;
  internal: boolean;
  arguments?: Record<string, unknown>;
}

export interface BindingInfo {
  source: string;
  vhost: string;
  destination: string;
  destination_type: string;
  routing_key: string;
  arguments?: Record<string, unknown>;
  properties_key?: string;
}

export interface ConnectionInfo {
  name: string;
  vhost: string;
  user: string;
  state: string;
  channels: number;
  connected_at: number;
  host: string;
  port: number;
  peer_host: string;
  peer_port: number;
  client_properties?: Record<string, unknown>;
  node?: string;
}

export interface ConsumerInfo {
  consumer_tag: string;
  channel_details: {
    connection_name: string;
    name: string;
    node: string;
    number: number;
    peer_host: string;
    peer_port: number;
    user: string;
  };
  queue: {
    name: string;
    vhost: string;
  };
  ack_required: boolean;
  prefetch_count: number;
  active: boolean;
}

export interface MessageStats {
  publish?: number;
  publish_details?: RateDetails;
  deliver_get?: number;
  deliver_get_details?: RateDetails;
  deliver?: number;
  deliver_details?: RateDetails;
  ack?: number;
  ack_details?: RateDetails;
  redeliver?: number;
  redeliver_details?: RateDetails;
}

export interface RateDetails {
  rate: number;
}

export interface OverviewInfo {
  management_version: string;
  cluster_name: string;
  erlang_version: string;
  rabbitmq_version: string;
  node: string;
  queue_totals: {
    messages: number;
    messages_ready: number;
    messages_unacknowledged: number;
  };
  object_totals: {
    connections: number;
    channels: number;
    exchanges: number;
    queues: number;
    consumers: number;
  };
  message_stats?: MessageStats;
  listeners: Array<{
    node: string;
    protocol: string;
    port: number;
  }>;
}

export interface PeekedMessage {
  payload: string;
  payload_bytes: number;
  payload_encoding: string;
  redelivered: boolean;
  exchange: string;
  routing_key: string;
  message_count: number;
  properties: {
    headers?: Record<string, unknown>;
    content_type?: string;
    delivery_mode?: number;
    message_id?: string;
    correlation_id?: string;
    type?: string;
    app_id?: string;
    timestamp?: number;
  };
}

export interface MassTransitEnvelope {
  messageId?: string;
  correlationId?: string;
  conversationId?: string;
  initiatorId?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  messageType?: string[];
  message?: Record<string, unknown>;
  sentTime?: string;
  headers?: Record<string, unknown>;
  host?: {
    machineName?: string;
    processName?: string;
    processId?: number;
    assembly?: string;
    assemblyVersion?: string;
    frameworkVersion?: string;
    massTransitVersion?: string;
    operatingSystemVersion?: string;
  };
}

export interface MassTransitFault {
  faultId?: string;
  faultedMessageId?: string;
  timestamp?: string;
  exceptions?: MassTransitException[];
  message?: Record<string, unknown>;
  host?: MassTransitEnvelope["host"];
}

export interface MassTransitException {
  exceptionType?: string;
  message?: string;
  stackTrace?: string;
  innerException?: MassTransitException;
  source?: string;
}

export interface ParsedFaultMessage {
  faultedAt: string;
  originalMessageId: string;
  messageTypes: string[];
  exceptionType: string;
  exceptionMessage: string;
  stackTrace: string;
  originalPayload: Record<string, unknown> | null;
  sourceHost: string;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}>;
