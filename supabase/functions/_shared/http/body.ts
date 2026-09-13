import { NexaError } from "../errors/nexa-error.ts";

export const MAX_HTTP_BODY_BYTES = 32_768;

function payloadTooLarge(): NexaError {
  return new NexaError(
    "PAYLOAD_TOO_LARGE",
    "A solicitação excede o tamanho permitido.",
    413,
  );
}

function rejectDeclaredOversize(request: Request, maxBytes: number): void {
  const header = request.headers.get("content-length");
  if (header === null || !/^\d+$/.test(header.trim())) return;

  const declaredBytes = Number(header);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
    throw payloadTooLarge();
  }
}

async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  rejectDeclaredOversize(request, maxBytes);

  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const body = new Uint8Array(maxBytes);
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;

      if (value.byteLength > maxBytes - totalBytes) {
        try {
          await reader.cancel("request body limit exceeded");
        } catch {
          // The payload remains rejected even if the source cannot be canceled.
        }
        throw payloadTooLarge();
      }

      body.set(value, totalBytes);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return body.subarray(0, totalBytes);
}

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_HTTP_BODY_BYTES,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    throw new NexaError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Use Content-Type application/json.",
      415,
    );
  }

  const encodedBody = await readBodyBytes(request, maxBytes);
  const body = new TextDecoder().decode(encodedBody);

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
