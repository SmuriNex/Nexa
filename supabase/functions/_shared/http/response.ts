import type { ApiErrorBody, ApiSuccess } from "../types/chat.ts";
import type { NexaError } from "../errors/nexa-error.ts";

function responseHeaders(cors: Headers, requestId: string): Headers {
  const headers = new Headers(cors);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("x-request-id", requestId);
  return headers;
}

export function successResponse<T>(
  data: T,
  requestId: string,
  cors: Headers,
  status = 200,
): Response {
  const body: ApiSuccess<T> = {
    ok: true,
    data,
    request_id: requestId,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(cors, requestId),
  });
}

export function errorResponse(
  error: NexaError,
  requestId: string,
  cors: Headers,
): Response {
  const body: ApiErrorBody = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
    request_id: requestId,
  };

  const headers = responseHeaders(cors, requestId);
  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }

  return new Response(JSON.stringify(body), {
    status: error.status,
    headers,
  });
}
