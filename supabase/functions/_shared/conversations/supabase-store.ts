import type { FetchLike } from "../ai/provider.ts";
import type { AIHistoryMessage } from "../ai/provider.ts";
import type { AuthenticatedPrincipal } from "../auth/authenticate.ts";
import { NexaError } from "../errors/nexa-error.ts";
import { isUuid } from "../validation/uuid.ts";
import type {
  CommitTurnInput,
  ConversationRecord,
  ConversationStore,
  MessageRecord,
} from "./conversation-service.ts";

function databaseUnavailable(): NexaError {
  return new NexaError(
    "DATABASE_UNAVAILABLE",
    "O armazenamento está temporariamente indisponível.",
    503,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConversation(value: unknown): ConversationRecord {
  if (
    !isRecord(value) || !isUuid(value.id) ||
    !["nexa", "ascent", "erp"].includes(String(value.app)) ||
    typeof value.title !== "string" ||
    typeof value.created_at !== "string" || typeof value.updated_at !== "string"
  ) throw databaseUnavailable();

  return value as unknown as ConversationRecord;
}

function parseMessage(value: unknown): MessageRecord {
  if (
    !isRecord(value) || !isUuid(value.id) || !isUuid(value.conversation_id) ||
    !["user", "assistant"].includes(String(value.role)) ||
    typeof value.content !== "string" || typeof value.created_at !== "string" ||
    !(value.provider === null || typeof value.provider === "string") ||
    !(value.model === null || typeof value.model === "string") ||
    !(value.request_id === null || typeof value.request_id === "string")
  ) throw databaseUnavailable();

  return value as unknown as MessageRecord;
}

export class SupabaseConversationStore implements ConversationStore {
  private readonly principal: AuthenticatedPrincipal;
  private readonly fetchImplementation: FetchLike;

  constructor(
    principal: AuthenticatedPrincipal,
    fetchImplementation: FetchLike = fetch,
  ) {
    this.principal = principal;
    this.fetchImplementation = fetchImplementation;
  }

  private async request(
    path: string,
    init: { method?: string; body?: unknown; prefer?: string; privileged?: boolean } = {},
  ): Promise<Response> {
    const credential = init.privileged
      ? this.principal.connection.serviceRoleKey
      : this.principal.connection.publishableKey;
    const bearer = init.privileged ? credential : this.principal.accessToken;
    if (!credential || !bearer) {
      throw new NexaError(
        "CONFIGURATION_ERROR",
        "A configuração interna da Nexa é inválida.",
        500,
      );
    }
    const headers = new Headers({
      Accept: "application/json",
      apikey: credential,
      Authorization: `Bearer ${bearer}`,
      "Cache-Control": "no-store",
    });
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (init.prefer) headers.set("Prefer", init.prefer);

    try {
      return await this.fetchImplementation(
        `${this.principal.connection.url}/rest/v1/${path}`,
        {
          method: init.method ?? "GET",
          headers,
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw databaseUnavailable();
    }
  }

  private async rows(response: Response): Promise<unknown[]> {
    if (!response.ok) throw databaseUnavailable();
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw databaseUnavailable();
    }
    if (!Array.isArray(data)) throw databaseUnavailable();
    return data;
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    const query = new URLSearchParams({
      select: "id,app,title,created_at,updated_at",
      id: `eq.${id}`,
      user_id: `eq.${this.principal.userId}`,
      limit: "1",
    });
    const rows = await this.rows(await this.request(`conversations?${query}`));
    return rows.length === 0 ? null : parseConversation(rows[0]);
  }

  async getRecentMessages(id: string, limit: number): Promise<AIHistoryMessage[]> {
    const query = new URLSearchParams({
      select: "role,content",
      conversation_id: `eq.${id}`,
      order: "created_at.desc,id.desc",
      limit: String(limit),
    });
    const rows = await this.rows(await this.request(`messages?${query}`));
    return rows.reverse().map((row) => {
      if (
        !isRecord(row) || !["user", "assistant"].includes(String(row.role)) ||
        typeof row.content !== "string"
      ) throw databaseUnavailable();
      return { role: row.role as "user" | "assistant", content: row.content };
    });
  }

  async consumeRateLimit(maxRequests: number): Promise<{
    allowed: boolean;
    retryAfterSeconds: number;
  }> {
    const rows = await this.rows(
      await this.request("rpc/nexa_consume_rate_limit", {
        method: "POST",
        body: { p_window_seconds: 60, p_max_requests: maxRequests },
      }),
    );
    const result = rows[0];
    if (
      !isRecord(result) || typeof result.allowed !== "boolean" ||
      !Number.isInteger(result.retry_after_seconds)
    ) throw databaseUnavailable();
    return {
      allowed: result.allowed,
      retryAfterSeconds: Number(result.retry_after_seconds),
    };
  }

  async commitTurn(input: CommitTurnInput): Promise<void> {
    const rows = await this.rows(
      await this.request("rpc/nexa_append_turn", {
        method: "POST",
        privileged: true,
        body: {
          p_user_id: this.principal.userId,
          p_conversation_id: input.conversationId,
          p_create_new: input.createNew,
          p_app: input.app,
          p_user_content: input.userContent,
          p_assistant_content: input.assistantContent,
          p_provider: input.provider,
          p_model: input.model,
          p_request_id: input.requestId,
        },
      }),
    );
    if (
      rows.length !== 1 || !isRecord(rows[0]) ||
      rows[0].conversation_id !== input.conversationId ||
      !isUuid(rows[0].user_message_id) || !isUuid(rows[0].assistant_message_id)
    ) {
      throw databaseUnavailable();
    }
  }

  async listConversations(limit: number, offset: number): Promise<ConversationRecord[]> {
    const query = new URLSearchParams({
      select: "id,app,title,created_at,updated_at",
      user_id: `eq.${this.principal.userId}`,
      order: "updated_at.desc,id.desc",
      limit: String(limit),
      offset: String(offset),
    });
    const rows = await this.rows(await this.request(`conversations?${query}`));
    return rows.map(parseConversation);
  }

  async listMessages(id: string, limit: number, offset: number): Promise<MessageRecord[]> {
    const query = new URLSearchParams({
      select: "id,conversation_id,role,content,provider,model,request_id,created_at",
      conversation_id: `eq.${id}`,
      order: "created_at.asc,id.asc",
      limit: String(limit),
      offset: String(offset),
    });
    const rows = await this.rows(await this.request(`messages?${query}`));
    return rows.map(parseMessage);
  }

  async deleteConversation(id: string): Promise<boolean> {
    const query = new URLSearchParams({
      select: "id",
      id: `eq.${id}`,
      user_id: `eq.${this.principal.userId}`,
    });
    const rows = await this.rows(
      await this.request(`conversations?${query}`, {
        method: "DELETE",
        prefer: "return=representation",
      }),
    );
    return rows.length === 1 && isRecord(rows[0]) && rows[0].id === id;
  }
}
