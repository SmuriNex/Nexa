import { NexaError } from "../errors/nexa-error.ts";
import { type NexaApp, SUPPORTED_APPS } from "../types/chat.ts";
import {
  type CreateMemoryInput,
  MEMORY_CATEGORIES,
  MEMORY_CONTENT_MAX_CHARACTERS,
  MEMORY_SCOPES,
  type MemoryCategory,
  type MemoryRecord,
  type MemoryScope,
  type UpdateMemoryInput,
} from "./types.ts";

const ALLOWED_FIELDS = new Set(["scope", "app", "category", "content"]);

function invalidMemory(): NexaError {
  return new NexaError("INVALID_MEMORY", "Os dados da memória são inválidos.", 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scope(value: unknown): MemoryScope {
  if (typeof value !== "string" || !(MEMORY_SCOPES as readonly string[]).includes(value)) {
    throw invalidMemory();
  }
  return value as MemoryScope;
}

function category(value: unknown): MemoryCategory {
  if (
    typeof value !== "string" ||
    !(MEMORY_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw invalidMemory();
  }
  return value as MemoryCategory;
}

function appForScope(memoryScope: MemoryScope, value: unknown): NexaApp | null {
  if (memoryScope === "global") {
    if (value !== undefined && value !== null) throw invalidMemory();
    return null;
  }

  if (
    typeof value !== "string" ||
    !(SUPPORTED_APPS as readonly string[]).includes(value)
  ) {
    throw invalidMemory();
  }
  return value as NexaApp;
}

function content(value: unknown): string {
  if (typeof value !== "string") throw invalidMemory();
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new NexaError("EMPTY_MEMORY", "O conteúdo da memória não pode estar vazio.", 400);
  }
  if (normalized.length > MEMORY_CONTENT_MAX_CHARACTERS) {
    throw new NexaError(
      "MEMORY_TOO_LONG",
      "O conteúdo da memória excede o tamanho permitido.",
      400,
    );
  }
  return normalized;
}

function validateFields(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw invalidMemory();
  if (Object.keys(payload).some((key) => !ALLOWED_FIELDS.has(key))) throw invalidMemory();
  return payload;
}

export function validateCreateMemory(payload: unknown): CreateMemoryInput {
  const body = validateFields(payload);
  const memoryScope = scope(body.scope);
  return {
    scope: memoryScope,
    app: appForScope(memoryScope, body.app),
    category: category(body.category),
    content: content(body.content),
  };
}

export function validateUpdateMemory(
  payload: unknown,
  current: MemoryRecord,
): UpdateMemoryInput {
  const body = validateFields(payload);
  if (Object.keys(body).length === 0) throw invalidMemory();

  const memoryScope = body.scope === undefined ? current.scope : scope(body.scope);
  const nextApp = Object.hasOwn(body, "app")
    ? body.app
    : body.scope === "global"
    ? null
    : current.app;

  return {
    scope: memoryScope,
    app: appForScope(memoryScope, nextApp),
    category: body.category === undefined ? current.category : category(body.category),
    content: body.content === undefined ? current.content : content(body.content),
  };
}
