import { loadNexaConfig } from "../_shared/config/config.ts";
import { createAIProvider } from "../_shared/ai/provider-factory.ts";
import { NexaCore } from "../_shared/core/nexa-core.ts";
import { asNexaError, NexaError } from "../_shared/errors/nexa-error.ts";
import { corsHeaders, ensureOriginAllowed } from "../_shared/http/cors.ts";
import { errorResponse, successResponse } from "../_shared/http/response.ts";
import { logRequest } from "../_shared/logging/logger.ts";
import { resolveRequestId } from "../_shared/request/request-id.ts";

const MAX_HTTP_BODY_BYTES = 32_768;

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    throw new NexaError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Use Content-Type application/json.",
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_BODY_BYTES) {
    throw new NexaError(
      "PAYLOAD_TOO_LARGE",
      "A solicitação excede o tamanho permitido.",
      413,
    );
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_HTTP_BODY_BYTES) {
    throw new NexaError(
      "PAYLOAD_TOO_LARGE",
      "A solicitação excede o tamanho permitido.",
      413,
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new NexaError(
      "INVALID_JSON",
      "O corpo da solicitação não contém JSON válido.",
      400,
    );
  }
}

export async function handleChat(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const startedAt = performance.now();
  let cors = new Headers();
  let delegatedToCore = false;
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

    const payload = await readJsonBody(request);
    const core = new NexaCore(config, {
      providerFactory: () => createAIProvider(config),
    });
    delegatedToCore = true;
    const { requestId: normalizedRequestId, ...data } = await core.chat(
      payload,
      requestId,
    );

    return successResponse(data, normalizedRequestId, cors);
  } catch (error) {
    const safeError = asNexaError(error);
    if (!delegatedToCore) {
      logRequest({
        request_id: requestId,
        ...(primaryProvider ? { primary_provider: primaryProvider } : {}),
        fallback_used: false,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        success: false,
        error_code: safeError.code,
      });
    }
    return errorResponse(safeError, requestId, cors);
  }
}

export default { fetch: handleChat };
