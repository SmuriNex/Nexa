import type { NexaConfig } from "../config/config.ts";
import { NexaError } from "../errors/nexa-error.ts";

const ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-request-id",
].join(", ");

export function ensureOriginAllowed(request: Request, config: NexaConfig): void {
  const origin = request.headers.get("origin");
  if (origin && !config.allowedOrigins.includes(origin)) {
    throw new NexaError(
      "ORIGIN_NOT_ALLOWED",
      "A origem da solicitação não é permitida.",
      403,
    );
  }
}

export function corsHeaders(
  request: Request,
  config: NexaConfig,
  methods: readonly string[],
): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", "),
    "Access-Control-Expose-Headers": "x-request-id, Retry-After",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  const origin = request.headers.get("origin");
  if (origin && config.allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}
