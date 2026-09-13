import assert from "node:assert/strict";
import test from "node:test";

import { NexaError } from "../_shared/errors/nexa-error.ts";
import { readJsonBody } from "../_shared/http/body.ts";

function streamedRequest(
  chunks: readonly Uint8Array[],
  headers: Record<string, string> = {},
  onCancel?: (reason: unknown) => void,
): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel(reason) {
      onCancel?.(reason);
    },
  });

  return new Request("http://local.test/body", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

test("leitor JSON recompõe UTF-8 dividido em chunks dentro do limite", async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ message: "olá" }));
  const splitAt = encoded.indexOf(0xc3) + 1;
  const request = streamedRequest([
    encoded.slice(0, splitAt),
    encoded.slice(splitAt),
  ]);

  assert.deepEqual(await readJsonBody(request, encoded.byteLength), { message: "olá" });
});

test("leitor aceita JSON com exatamente 32 KiB", async () => {
  const prefix = '{"value":"';
  const suffix = '"}';
  const body = `${prefix}${"x".repeat(32_768 - prefix.length - suffix.length)}${suffix}`;
  const encoded = new TextEncoder().encode(body);
  assert.equal(encoded.byteLength, 32_768);

  const request = streamedRequest([encoded.slice(0, 16_384), encoded.slice(16_384)]);
  const parsed = await readJsonBody(request) as { value: string };

  assert.equal(parsed.value.length, 32_768 - prefix.length - suffix.length);
});

test("leitor cancela stream sem Content-Length ao exceder o limite", async () => {
  let cancelReason: unknown;
  const request = streamedRequest(
    [new Uint8Array(20), new Uint8Array(20), new Uint8Array(20)],
    {},
    (reason) => {
      cancelReason = reason;
    },
  );
  assert.equal(request.headers.get("content-length"), null);

  await assert.rejects(
    () => readJsonBody(request, 32),
    (error: unknown) =>
      error instanceof NexaError &&
      error.code === "PAYLOAD_TOO_LARGE" &&
      error.status === 413,
  );
  assert.equal(cancelReason, "request body limit exceeded");
});

test("Content-Length acima do limite retorna 413 sem consumir o corpo", async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
  });
  const request = new Request("http://local.test/body", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "33",
    },
    body: stream,
    duplex: "half",
  } as RequestInit);

  await assert.rejects(
    () => readJsonBody(request, 32),
    (error: unknown) =>
      error instanceof NexaError &&
      error.code === "PAYLOAD_TOO_LARGE" &&
      error.status === 413,
  );
  assert.equal(request.bodyUsed, false);
  assert.ok(pulls <= 1);
});

test("JSON inválido dentro do limite preserva erro 400", async () => {
  const encoded = new TextEncoder().encode("{invalid");
  const request = streamedRequest([encoded]);

  await assert.rejects(
    () => readJsonBody(request, encoded.byteLength),
    (error: unknown) =>
      error instanceof NexaError &&
      error.code === "INVALID_JSON" &&
      error.status === 400,
  );
});
