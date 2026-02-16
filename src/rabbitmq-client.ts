import type {
  RabbitMQConfig,
  QueueInfo,
  ExchangeInfo,
  BindingInfo,
  ConnectionInfo,
  ConsumerInfo,
  OverviewInfo,
  PeekedMessage,
} from "./types.js";

export class RabbitMQClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(private config: RabbitMQConfig) {
    const protocol = config.ssl ? "https" : "http";
    this.baseUrl = `${protocol}://${config.host}:${config.port}/api`;
    this.authHeader =
      "Basic " +
      Buffer.from(`${config.username}:${config.password}`).toString("base64");
  }

  private encodeVhost(vhost?: string): string {
    const v = vhost ?? this.config.vhost;
    return v === "/" ? "%2F" : encodeURIComponent(v);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `RabbitMQ API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  // Overview
  async getOverview(): Promise<OverviewInfo> {
    return this.get<OverviewInfo>("/overview");
  }

  // Queues
  async listQueues(vhost?: string): Promise<QueueInfo[]> {
    if (vhost) {
      return this.get<QueueInfo[]>(
        `/queues/${this.encodeVhost(vhost)}`
      );
    }
    return this.get<QueueInfo[]>("/queues");
  }

  async getQueue(name: string, vhost?: string): Promise<QueueInfo> {
    return this.get<QueueInfo>(
      `/queues/${this.encodeVhost(vhost)}/${encodeURIComponent(name)}`
    );
  }

  async purgeQueue(name: string, vhost?: string): Promise<void> {
    await this.del(
      `/queues/${this.encodeVhost(vhost)}/${encodeURIComponent(name)}/contents`
    );
  }

  async deleteQueue(name: string, vhost?: string): Promise<void> {
    await this.del(
      `/queues/${this.encodeVhost(vhost)}/${encodeURIComponent(name)}`
    );
  }

  // Exchanges
  async listExchanges(vhost?: string): Promise<ExchangeInfo[]> {
    if (vhost) {
      return this.get<ExchangeInfo[]>(
        `/exchanges/${this.encodeVhost(vhost)}`
      );
    }
    return this.get<ExchangeInfo[]>("/exchanges");
  }

  async getExchange(name: string, vhost?: string): Promise<ExchangeInfo> {
    return this.get<ExchangeInfo>(
      `/exchanges/${this.encodeVhost(vhost)}/${encodeURIComponent(name)}`
    );
  }

  // Bindings
  async listBindingsForQueue(
    queue: string,
    vhost?: string
  ): Promise<BindingInfo[]> {
    return this.get<BindingInfo[]>(
      `/queues/${this.encodeVhost(vhost)}/${encodeURIComponent(queue)}/bindings`
    );
  }

  async listBindingsForExchange(
    exchange: string,
    type: "source" | "destination",
    vhost?: string
  ): Promise<BindingInfo[]> {
    return this.get<BindingInfo[]>(
      `/exchanges/${this.encodeVhost(vhost)}/${encodeURIComponent(exchange)}/bindings/${type}`
    );
  }

  // Connections & Consumers
  async listConnections(): Promise<ConnectionInfo[]> {
    return this.get<ConnectionInfo[]>("/connections");
  }

  async listConsumers(vhost?: string): Promise<ConsumerInfo[]> {
    if (vhost) {
      return this.get<ConsumerInfo[]>(
        `/consumers/${this.encodeVhost(vhost)}`
      );
    }
    return this.get<ConsumerInfo[]>("/consumers");
  }

  // Messages
  async peekMessages(
    queue: string,
    count: number = 5,
    vhost?: string,
    ackMode: string = "ack_requeue_true"
  ): Promise<PeekedMessage[]> {
    return this.post<PeekedMessage[]>(
      `/queues/${this.encodeVhost(vhost)}/${encodeURIComponent(queue)}/get`,
      {
        count,
        ackmode: ackMode,
        encoding: "auto",
        truncate: 50000,
      }
    );
  }

  async publishMessage(
    exchange: string,
    routingKey: string,
    payload: string,
    properties: Record<string, unknown> = {},
    vhost?: string
  ): Promise<{ routed: boolean }> {
    return this.post<{ routed: boolean }>(
      `/exchanges/${this.encodeVhost(vhost)}/${encodeURIComponent(exchange)}/publish`,
      {
        routing_key: routingKey,
        payload,
        payload_encoding: "string",
        properties: {
          delivery_mode: 2,
          content_type: "application/vnd.masstransit+json",
          ...properties,
        },
      }
    );
  }

  async consumeMessages(
    queue: string,
    count: number = 1,
    vhost?: string
  ): Promise<PeekedMessage[]> {
    return this.post<PeekedMessage[]>(
      `/queues/${this.encodeVhost(vhost)}/${encodeURIComponent(queue)}/get`,
      {
        count,
        ackmode: "ack_requeue_false",
        encoding: "auto",
        truncate: 50000,
      }
    );
  }
}
