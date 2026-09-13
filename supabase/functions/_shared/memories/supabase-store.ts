import type { FetchLike } from "../ai/provider.ts";
import type { AuthenticatedPrincipal } from "../auth/authenticate.ts";
import { NexaError } from "../errors/nexa-error.ts";
import { SUPPORTED_APPS } from "../types/chat.ts";
import { isUuid } from "../validation/uuid.ts";
import {
  type CreateMemoryInput,
  MEMORY_CATEGORIES,
  MEMORY_CONTENT_MAX_CHARACTERS,
  MEMORY_CONTEXT_MAX_CHARACTERS,
  MEMORY_CONTEXT_MAX_ENTRIES,
  MEMORY_SCOPES,
  MEMORY_SOURCES,
  type MemoryContextEntry,
  type MemoryRecord,
  type MemoryStore,
  type UpdateMemoryInput,
} from "./types.ts";

const MEMORY_COLUMNS = "id,scope,app,category,content,source,created_at,updated_at";

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

function parseMemory(value: unknown): MemoryRecord {
  if (!isRecord(value) || !isUuid(value.id)) throw databaseUnavailable();
  if (!(MEMORY_SCOPES as readonly unknown[]).includes(value.scope)) throw databaseUnavailable();
  if (!(MEMORY_CATEGORIES as readonly unknown[]).includes(value.category)) {
    throw databaseUnavailable();
  }
  if (!(MEMORY_SOURCES as readonly unknown[]).includes(value.source)) throw databaseUnavailable();
  if (
    typeof value.content !== "string" || value.content.length === 0 ||
    value.content.length > MEMORY_CONTENT_MAX_CHARACTERS ||
    typeof value.created_at !== "string" || typeof value.updated_at !== "string"
  ) {
    throw databaseUnavailable();
  }

  const app = value.app;
  if (
    (value.scope === "global" && app !== null) ||
    (value.scope === "app" && !(SUPPORTED_APPS as readonly unknown[]).includes(app))
  ) {
    throw databaseUnavailable();
  }
  return value as unknown as MemoryRecord;
}

export function boundMemoriesForChat(
  memories: readonly MemoryRecord[],
): MemoryContextEntry[] {
  const bounded: MemoryContextEntry[] = [];
  let characters = 0;
  for (const memory of memories.slice(0, MEMORY_CONTEXT_MAX_ENTRIES)) {
    if (characters + memory.content.length > MEMORY_CONTEXT_MAX_CHARACTERS) break;
    bounded.push({
      scope: memory.scope,
      app: memory.app,
      category: memory.category,
      content: memory.content,
    });
    characters += memory.content.length;
  }
  return bounded;
}

export class SupabaseMemoryStore implements MemoryStore {
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
    init: { method?: string; body?: unknown; prefer?: string } = {},
  ): Promise<Response> {
    const headers = new Headers({
      Accept: "application/json",
      apikey: this.principal.connection.publishableKey,
      Authorization: `Bearer ${this.principal.accessToken}`,
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

  async getMemory(id: string): Promise<MemoryRecord | null> {
    const query = new URLSearchParams({
      select: MEMORY_COLUMNS,
      id: `eq.${id}`,
      user_id: `eq.${this.principal.userId}`,
      limit: "1",
    });
    const rows = await this.rows(await this.request(`memories?${query}`));
    return rows.length === 0 ? null : parseMemory(rows[0]);
  }

  async listMemories(limit: number, offset: number): Promise<MemoryRecord[]> {
    const query = new URLSearchParams({
      select: MEMORY_COLUMNS,
      user_id: `eq.${this.principal.userId}`,
      order: "updated_at.desc,id.desc",
      limit: String(limit),
      offset: String(offset),
    });
    const rows = await this.rows(await this.request(`memories?${query}`));
    return rows.map(parseMemory);
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    const rows = await this.rows(
      await this.request("memories", {
        method: "POST",
        body: input,
        prefer: "return=representation",
      }),
    );
    if (rows.length !== 1) throw databaseUnavailable();
    return parseMemory(rows[0]);
  }

  async updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryRecord | null> {
    const query = new URLSearchParams({
      id: `eq.${id}`,
      user_id: `eq.${this.principal.userId}`,
    });
    const rows = await this.rows(
      await this.request(`memories?${query}`, {
        method: "PATCH",
        body: input,
        prefer: "return=representation",
      }),
    );
    return rows.length === 0 ? null : parseMemory(rows[0]);
  }

  async deleteMemory(id: string): Promise<boolean> {
    const query = new URLSearchParams({
      select: "id",
      id: `eq.${id}`,
      user_id: `eq.${this.principal.userId}`,
    });
    const rows = await this.rows(
      await this.request(`memories?${query}`, {
        method: "DELETE",
        prefer: "return=representation",
      }),
    );
    return rows.length === 1 && isRecord(rows[0]) && rows[0].id === id;
  }

  async listForChat(app: (typeof SUPPORTED_APPS)[number]): Promise<MemoryContextEntry[]> {
    const query = new URLSearchParams({
      select: MEMORY_COLUMNS,
      user_id: `eq.${this.principal.userId}`,
      or: `(scope.eq.global,and(scope.eq.app,app.eq.${app}))`,
      order: "updated_at.desc,id.desc",
      limit: String(MEMORY_CONTEXT_MAX_ENTRIES),
    });
    const rows = await this.rows(await this.request(`memories?${query}`));
    return boundMemoriesForChat(rows.map(parseMemory));
  }
}
