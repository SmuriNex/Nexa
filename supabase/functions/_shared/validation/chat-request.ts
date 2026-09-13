import { NexaError } from "../errors/nexa-error.ts";
import { type ChatRequest, type NexaApp, SUPPORTED_APPS } from "../types/chat.ts";

export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_CONTEXT_BYTES = 16_384;
export const MAX_CONVERSATION_ID_LENGTH = 128;

const ALLOWED_FIELDS = new Set([
  "app",
  "message",
  "conversation_id",
  "context",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedApp(value: unknown): value is NexaApp {
  return typeof value === "string" &&
    (SUPPORTED_APPS as readonly string[]).includes(value);
}

function validateContext(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new NexaError(
      "INVALID_CONTEXT",
      "O campo context deve ser um objeto.",
      400,
    );
  }

  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new NexaError(
      "INVALID_CONTEXT",
      "O campo context deve ser um objeto JSON válido.",
      400,
    );
  }

  if (bytes > MAX_CONTEXT_BYTES) {
    throw new NexaError(
      "CONTEXT_TOO_LARGE",
      "O contexto enviado excede o tamanho permitido.",
      400,
    );
  }

  return value;
}

export function validateChatRequest(payload: unknown): ChatRequest {
  if (!isRecord(payload)) {
    throw new NexaError(
      "INVALID_REQUEST",
      "A solicitação deve ser um objeto JSON.",
      400,
    );
  }

  const unknownField = Object.keys(payload).find((key) => !ALLOWED_FIELDS.has(key));
  if (unknownField) {
    throw new NexaError(
      "INVALID_REQUEST",
      "A solicitação contém campos não reconhecidos.",
      400,
    );
  }

  if (!isSupportedApp(payload.app)) {
    throw new NexaError(
      "INVALID_APP",
      "O aplicativo informado não é reconhecido pela Nexa.",
      400,
    );
  }

  if (typeof payload.message !== "string") {
    throw new NexaError(
      "INVALID_REQUEST",
      "O campo message é obrigatório e deve ser texto.",
      400,
    );
  }

  const message = payload.message.trim();
  if (!message) {
    throw new NexaError(
      "EMPTY_MESSAGE",
      "A mensagem não pode estar vazia.",
      400,
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new NexaError(
      "MESSAGE_TOO_LONG",
      "A mensagem excede o tamanho permitido.",
      400,
    );
  }

  let conversationId: string | undefined;
  if (payload.conversation_id !== undefined) {
    if (typeof payload.conversation_id !== "string") {
      throw new NexaError(
        "INVALID_CONVERSATION_ID",
        "O identificador da conversa é inválido.",
        400,
      );
    }

    conversationId = payload.conversation_id.trim();
    if (!conversationId || conversationId.length > MAX_CONVERSATION_ID_LENGTH) {
      throw new NexaError(
        "INVALID_CONVERSATION_ID",
        "O identificador da conversa é inválido.",
        400,
      );
    }
  }

  const context = payload.context === undefined ? undefined : validateContext(payload.context);

  return {
    app: payload.app,
    message,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(context ? { context } : {}),
  };
}
