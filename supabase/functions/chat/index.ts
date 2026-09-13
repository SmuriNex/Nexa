import { loadNexaConfig } from "../_shared/config/config.ts";
import { createAIProvider } from "../_shared/ai/provider-factory.ts";
import { type AuthenticatedPrincipal, authenticateRequest } from "../_shared/auth/authenticate.ts";
import {
  ConversationService,
  type ConversationStore,
} from "../_shared/conversations/conversation-service.ts";
import { SupabaseConversationStore } from "../_shared/conversations/supabase-store.ts";
import { NexaCore } from "../_shared/core/nexa-core.ts";
import { asNexaError, NexaError } from "../_shared/errors/nexa-error.ts";
import { readJsonBody } from "../_shared/http/body.ts";
import { corsHeaders, ensureOriginAllowed } from "../_shared/http/cors.ts";
import { errorResponse, successResponse } from "../_shared/http/response.ts";
import { logRequest } from "../_shared/logging/logger.ts";
import { resolveRequestId } from "../_shared/request/request-id.ts";
import type { MemoryContextStore } from "../_shared/memories/types.ts";
import { SupabaseMemoryStore } from "../_shared/memories/supabase-store.ts";

export interface ChatHandlerDependencies {
  authenticate?: (request: Request) => Promise<AuthenticatedPrincipal>;
  storeFactory?: (principal: AuthenticatedPrincipal) => ConversationStore;
  memoryStoreFactory?: (principal: AuthenticatedPrincipal) => MemoryContextStore;
  coreFactory?: (config: ReturnType<typeof loadNexaConfig>) => NexaCore;
}

export async function handleChat(
  request: Request,
  dependencies: ChatHandlerDependencies = {},
): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const startedAt = performance.now();
  let cors = new Headers();
  let primaryProvider: string | undefined;

  try {
    const config = loadNexaConfig();
    primaryProvider = config.primaryProvider;
    cors = corsHeaders(request, config, ["POST"]);
    ensureOriginAllowed(request, config);

    if (request.method === "OPTIONS") {
      const headers = new Headers(cors);
      headers.set("x-request-id", requestId);
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      throw new NexaError(
        "METHOD_NOT_ALLOWED",
        "Método HTTP não permitido.",
        405,
      );
    }

    const principal = await (dependencies.authenticate ?? authenticateRequest)(request);
    const payload = await readJsonBody(request);
    const core = dependencies.coreFactory?.(config) ?? new NexaCore(config, {
      providerFactory: () => createAIProvider(config),
    });
    const store = dependencies.storeFactory?.(principal) ??
      new SupabaseConversationStore(principal);
    const memoryStore = dependencies.memoryStoreFactory?.(principal) ??
      new SupabaseMemoryStore(principal);
    const service = new ConversationService(store, core, config.rateLimitPerMinute, memoryStore);
    const data = await service.chat(payload, requestId);

    logRequest({
      stage: "request",
      request_id: requestId,
      app: data.app,
      conversation_id: data.conversation_id,
      primary_provider: primaryProvider,
      provider: data.provider,
      fallback_used: data.provider !== primaryProvider,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: true,
    });

    return successResponse(data, requestId, cors);
  } catch (error) {
    const safeError = asNexaError(error);
    logRequest({
      stage: "request",
      request_id: requestId,
      ...(primaryProvider ? { primary_provider: primaryProvider } : {}),
      fallback_used: false,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: false,
      error_code: safeError.code,
    });
    return errorResponse(safeError, requestId, cors);
  }
}

export default { fetch: handleChat };
