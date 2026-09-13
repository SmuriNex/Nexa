import { loadNexaConfig } from "../_shared/config/config.ts";
import { asNexaError, NexaError } from "../_shared/errors/nexa-error.ts";
import { corsHeaders, ensureOriginAllowed } from "../_shared/http/cors.ts";
import { errorResponse } from "../_shared/http/response.ts";
import { logRequest } from "../_shared/logging/logger.ts";
import { resolveRequestId } from "../_shared/request/request-id.ts";

export function handleHealth(request: Request): Response {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const startedAt = performance.now();
  let cors = new Headers();

  try {
    const config = loadNexaConfig();
    cors = corsHeaders(request, config, ["GET"]);
    ensureOriginAllowed(request, config);

    if (request.method === "OPTIONS") {
      const headers = new Headers(cors);
      headers.set("x-request-id", requestId);
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "GET") {
      throw new NexaError(
        "METHOD_NOT_ALLOWED",
        "Método HTTP não permitido.",
        405,
      );
    }

    const body = {
      ok: true,
      service: "nexa",
      version: config.version,
      environment: config.environment,
      request_id: requestId,
    };
    const headers = new Headers(cors);
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("x-request-id", requestId);

    logRequest({
      stage: "request",
      request_id: requestId,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      success: true,
    });

    return new Response(JSON.stringify(body), { status: 200, headers });
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

export default { fetch: handleHealth };
