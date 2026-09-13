import { type AuthenticatedPrincipal, authenticateRequest } from "../_shared/auth/authenticate.ts";
import { loadNexaConfig } from "../_shared/config/config.ts";
import type { ConversationStore } from "../_shared/conversations/conversation-service.ts";
import { SupabaseConversationStore } from "../_shared/conversations/supabase-store.ts";
import { asNexaError, NexaError } from "../_shared/errors/nexa-error.ts";
import { corsHeaders, ensureOriginAllowed } from "../_shared/http/cors.ts";
import { errorResponse, successResponse } from "../_shared/http/response.ts";
import { logRequest } from "../_shared/logging/logger.ts";
import { resolveRequestId } from "../_shared/request/request-id.ts";
import { isUuid } from "../_shared/validation/uuid.ts";

const MAX_PAGE_OFFSET = 10_000;

export interface ConversationsHandlerDependencies {
  authenticate?: (request: Request) => Promise<AuthenticatedPrincipal>;
  storeFactory?: (principal: AuthenticatedPrincipal) => ConversationStore;
}

function pageParameter(url: URL, name: string, fallback: number, maximum: number): number {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0])) {
    throw new NexaError("INVALID_PAGINATION", "Parâmetros de paginação inválidos.", 400);
  }
  const number = Number(values[0]);
  if (!Number.isSafeInteger(number) || number > maximum || (name === "limit" && number < 1)) {
    throw new NexaError("INVALID_PAGINATION", "Parâmetros de paginação inválidos.", 400);
  }
  return number;
}

function route(url: URL): string | null {
  const match = /^\/(?:functions\/v1\/)?conversations(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) throw new NexaError("NOT_FOUND", "Recurso não encontrado.", 404);
  if (!match[1]) return null;
  if (!isUuid(match[1])) {
    throw new NexaError("INVALID_CONVERSATION_ID", "Identificador de conversa inválido.", 400);
  }
  return match[1];
}

export async function handleConversations(
  request: Request,
  dependencies: ConversationsHandlerDependencies = {},
): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const startedAt = performance.now();
  let cors = new Headers();
  let conversationId: string | null = null;

  try {
    const config = loadNexaConfig();
    cors = corsHeaders(request, config, ["GET", "DELETE"]);
    ensureOriginAllowed(request, config);

    if (request.method === "OPTIONS") {
      const headers = new Headers(cors);
      headers.set("x-request-id", requestId);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET" && request.method !== "DELETE") {
      throw new NexaError("METHOD_NOT_ALLOWED", "Método HTTP não permitido.", 405);
    }

    const principal = await (dependencies.authenticate ?? authenticateRequest)(request);
    const store = dependencies.storeFactory?.(principal) ??
      new SupabaseConversationStore(principal);
    const url = new URL(request.url);
    conversationId = route(url);
    let data: unknown;

    if (request.method === "GET" && conversationId === null) {
      const limit = pageParameter(url, "limit", 20, 50);
      const offset = pageParameter(url, "offset", 0, MAX_PAGE_OFFSET);
      data = {
        conversations: await store.listConversations(limit, offset),
        pagination: { limit, offset },
      };
    } else if (request.method === "GET" && conversationId !== null) {
      const conversation = await store.getConversation(conversationId);
      if (!conversation) {
        throw new NexaError("CONVERSATION_NOT_FOUND", "Conversa não encontrada.", 404);
      }
      const limit = pageParameter(url, "limit", 50, 100);
      const offset = pageParameter(url, "offset", 0, MAX_PAGE_OFFSET);
      data = {
        conversation,
        messages: await store.listMessages(conversationId, limit, offset),
        pagination: { limit, offset },
      };
    } else if (request.method === "DELETE" && conversationId !== null) {
      const deleted = await store.deleteConversation(conversationId);
      if (!deleted) {
        throw new NexaError("CONVERSATION_NOT_FOUND", "Conversa não encontrada.", 404);
      }
      data = { conversation_id: conversationId, deleted: true };
    } else {
      throw new NexaError("METHOD_NOT_ALLOWED", "Método HTTP não permitido.", 405);
    }

    logRequest({
      stage: "request",
      request_id: requestId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: true,
    });
    return successResponse(data, requestId, cors);
  } catch (error) {
    const safeError = asNexaError(error);
    logRequest({
      stage: "request",
      request_id: requestId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: false,
      error_code: safeError.code,
    });
    return errorResponse(safeError, requestId, cors);
  }
}

export default { fetch: handleConversations };
