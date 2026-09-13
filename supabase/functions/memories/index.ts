import { type AuthenticatedPrincipal, authenticateRequest } from "../_shared/auth/authenticate.ts";
import { loadNexaConfig } from "../_shared/config/config.ts";
import { asNexaError, NexaError } from "../_shared/errors/nexa-error.ts";
import { corsHeaders, ensureOriginAllowed } from "../_shared/http/cors.ts";
import { readJsonBody } from "../_shared/http/body.ts";
import { errorResponse, successResponse } from "../_shared/http/response.ts";
import { logRequest } from "../_shared/logging/logger.ts";
import { SupabaseMemoryStore } from "../_shared/memories/supabase-store.ts";
import type { MemoryStore } from "../_shared/memories/types.ts";
import { validateCreateMemory, validateUpdateMemory } from "../_shared/memories/validation.ts";
import { resolveRequestId } from "../_shared/request/request-id.ts";
import { isUuid } from "../_shared/validation/uuid.ts";

const MAX_HTTP_BODY_BYTES = 8_192;
const MAX_PAGE_OFFSET = 10_000;

export interface MemoriesHandlerDependencies {
  authenticate?: (request: Request) => Promise<AuthenticatedPrincipal>;
  storeFactory?: (principal: AuthenticatedPrincipal) => MemoryStore;
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
  const match = /^\/(?:functions\/v1\/)?memories(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) throw new NexaError("NOT_FOUND", "Recurso não encontrado.", 404);
  if (!match[1]) return null;
  if (!isUuid(match[1])) {
    throw new NexaError("INVALID_MEMORY_ID", "Identificador de memória inválido.", 400);
  }
  return match[1];
}

function memoryNotFound(): NexaError {
  return new NexaError("MEMORY_NOT_FOUND", "Memória não encontrada.", 404);
}

export async function handleMemories(
  request: Request,
  dependencies: MemoriesHandlerDependencies = {},
): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const startedAt = performance.now();
  let cors = new Headers();

  try {
    const config = loadNexaConfig();
    cors = corsHeaders(request, config, ["GET", "POST", "PATCH", "DELETE"]);
    ensureOriginAllowed(request, config);

    if (request.method === "OPTIONS") {
      const headers = new Headers(cors);
      headers.set("x-request-id", requestId);
      return new Response(null, { status: 204, headers });
    }
    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
      throw new NexaError("METHOD_NOT_ALLOWED", "Método HTTP não permitido.", 405);
    }

    const principal = await (dependencies.authenticate ?? authenticateRequest)(request);
    const url = new URL(request.url);
    const memoryId = route(url);
    const payload = (request.method === "POST" && memoryId === null) ||
        (request.method === "PATCH" && memoryId !== null)
      ? await readJsonBody(request, MAX_HTTP_BODY_BYTES)
      : undefined;
    const store = dependencies.storeFactory?.(principal) ?? new SupabaseMemoryStore(principal);

    let data: unknown;
    let status = 200;
    if (request.method === "GET" && memoryId === null) {
      const limit = pageParameter(url, "limit", 20, 50);
      const offset = pageParameter(url, "offset", 0, MAX_PAGE_OFFSET);
      data = {
        memories: await store.listMemories(limit, offset),
        pagination: { limit, offset },
      };
    } else if (request.method === "GET" && memoryId !== null) {
      const memory = await store.getMemory(memoryId);
      if (!memory) throw memoryNotFound();
      data = { memory };
    } else if (request.method === "POST" && memoryId === null) {
      const input = validateCreateMemory(payload);
      data = { memory: await store.createMemory(input) };
      status = 201;
    } else if (request.method === "PATCH" && memoryId !== null) {
      const current = await store.getMemory(memoryId);
      if (!current) throw memoryNotFound();
      const input = validateUpdateMemory(payload, current);
      const memory = await store.updateMemory(memoryId, input);
      if (!memory) throw memoryNotFound();
      data = { memory };
    } else if (request.method === "DELETE" && memoryId !== null) {
      if (!(await store.deleteMemory(memoryId))) throw memoryNotFound();
      data = { memory_id: memoryId, deleted: true };
    } else {
      throw new NexaError("METHOD_NOT_ALLOWED", "Método HTTP não permitido.", 405);
    }

    logRequest({
      stage: "request",
      request_id: requestId,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: true,
    });
    return successResponse(data, requestId, cors, status);
  } catch (error) {
    const safeError = asNexaError(error);
    logRequest({
      stage: "request",
      request_id: requestId,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: false,
      error_code: safeError.code,
    });
    return errorResponse(safeError, requestId, cors);
  }
}

export default { fetch: handleMemories };
