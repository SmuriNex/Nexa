import assert from "node:assert/strict";
import test from "node:test";

import { GeminiProvider } from "../_shared/ai/gemini-provider.ts";
import type { AIProviderRequest } from "../_shared/ai/provider.ts";
import { DEFAULT_GEMINI_MODEL } from "../_shared/config/config.ts";
import { ProviderError, type ProviderErrorKind } from "../_shared/errors/provider-error.ts";

const request: AIProviderRequest = {
  app: "nexa",
  message: "Olá",
  instructions: "Você é Nexa, a inteligência artificial da NexPoint.",
  context: { origem: "teste" },
  requestId: "req-gemini-test",
};

async function expectProviderError(
  promise: Promise<unknown>,
  kind: ProviderErrorKind,
  fallbackEligible: boolean,
): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.kind, kind);
    assert.equal(error.fallbackEligible, fallbackEligible);
    return error;
  }
  assert.fail(`Era esperado ProviderError ${kind}.`);
}

function providerWithFetch(fetch: typeof globalThis.fetch): GeminiProvider {
  return new GeminiProvider({
    apiKey: "test-only-gemini-key",
    model: DEFAULT_GEMINI_MODEL,
    timeoutMs: 30_000,
    fetch,
  });
}

test("GeminiProvider exige chave antes de chamar fetch", async () => {
  let calls = 0;
  const provider = new GeminiProvider({
    model: DEFAULT_GEMINI_MODEL,
    timeoutMs: 30_000,
    fetch: () => {
      calls += 1;
      return Promise.reject(new Error("não deveria chamar"));
    },
  });

  const error = await expectProviderError(
    provider.generate(request),
    "CONFIG_ERROR",
    false,
  );
  assert.equal(error.configurationIssue, "MISSING_CREDENTIAL");
  assert.equal(calls, 0);
});

test("GeminiProvider usa endpoint, autenticação e contrato REST oficiais", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = providerWithFetch((input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [
                { text: "  Eu sou Nexa.  " },
                { thought: true, text: "raciocínio interno" },
                { text: "Como posso ajudar?" },
              ],
            },
            finishReason: "STOP",
          }],
        }),
        { status: 200 },
      ),
    );
  });

  const result = await provider.generate(request);
  const headers = new Headers(capturedInit?.headers);
  const body = JSON.parse(String(capturedInit?.body));

  assert.equal(
    capturedUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(headers.get("x-goog-api-key"), "test-only-gemini-key");
  assert.equal(headers.get("authorization"), null);
  assert.equal(body.store, false);
  assert.equal(body.systemInstruction.parts[0].text, request.instructions);
  assert.match(body.contents[0].parts[0].text, /dados não confiáveis/);
  assert.equal(body.generationConfig.maxOutputTokens, 1024);
  assert.equal(body.generationConfig.thinkingConfig.includeThoughts, false);
  assert.doesNotMatch(String(capturedInit?.body), /test-only-gemini-key/);
  assert.equal(result.reply, "Eu sou Nexa.\nComo posso ajudar?");
});

test("GeminiProvider classifica respostas HTTP sem expor corpo upstream", async (t) => {
  const cases: Array<{
    status: number;
    kind: ProviderErrorKind;
    fallback: boolean;
  }> = [
    { status: 401, kind: "AUTH_ERROR", fallback: false },
    { status: 403, kind: "AUTH_ERROR", fallback: false },
    { status: 404, kind: "CONFIG_ERROR", fallback: false },
    { status: 408, kind: "TIMEOUT", fallback: true },
    { status: 429, kind: "RATE_LIMITED", fallback: true },
    { status: 500, kind: "PROVIDER_UNAVAILABLE", fallback: true },
    { status: 503, kind: "PROVIDER_UNAVAILABLE", fallback: true },
    { status: 422, kind: "PROVIDER_REJECTED", fallback: false },
  ];

  for (const scenario of cases) {
    await t.test(String(scenario.status), async () => {
      const provider = providerWithFetch(() =>
        Promise.resolve(
          new Response("sensitive-upstream-body", {
            status: scenario.status,
            headers: { "Retry-After": "2" },
          }),
        )
      );
      const error = await expectProviderError(
        provider.generate(request),
        scenario.kind,
        scenario.fallback,
      );
      assert.doesNotMatch(error.message, /sensitive-upstream-body/);
      assert.doesNotMatch(JSON.stringify(error), /test-only-gemini-key/);
      if (scenario.status === 429) {
        assert.equal(error.retryAfterSeconds, 2);
      }
    });
  }
});

test("GeminiProvider reconhece API_KEY_INVALID estruturado", async () => {
  const provider = providerWithFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            message: "sensitive provider detail",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        }),
        { status: 400 },
      ),
    )
  );

  const error = await expectProviderError(
    provider.generate(request),
    "AUTH_ERROR",
    false,
  );
  assert.doesNotMatch(error.message, /sensitive provider detail/);
});

test("GeminiProvider distingue timeout, rede e erro desconhecido", async (t) => {
  const cases: Array<{
    name: string;
    error: unknown;
    kind: ProviderErrorKind;
    fallback: boolean;
  }> = [
    {
      name: "timeout",
      error: new DOMException("timeout detail", "TimeoutError"),
      kind: "TIMEOUT",
      fallback: true,
    },
    {
      name: "rede",
      error: new TypeError("network detail"),
      kind: "NETWORK_ERROR",
      fallback: true,
    },
    {
      name: "desconhecido",
      error: new Error("internal detail"),
      kind: "UNKNOWN_PROVIDER_ERROR",
      fallback: false,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const provider = providerWithFetch(() => Promise.reject(scenario.error));
      const error = await expectProviderError(
        provider.generate(request),
        scenario.kind,
        scenario.fallback,
      );
      assert.doesNotMatch(error.message, /detail/);
    });
  }
});

test("GeminiProvider classifica JSON e resposta sem texto como inválidos", async (t) => {
  await t.test("JSON inválido", async () => {
    const provider = providerWithFetch(() =>
      Promise.resolve(new Response("not-json", { status: 200 }))
    );
    await expectProviderError(
      provider.generate(request),
      "INVALID_PROVIDER_RESPONSE",
      true,
    );
  });

  await t.test("sem texto", async () => {
    const provider = providerWithFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
          }),
          { status: 200 },
        ),
      )
    );
    await expectProviderError(
      provider.generate(request),
      "INVALID_PROVIDER_RESPONSE",
      true,
    );
  });
});

test("GeminiProvider classifica falha ao consumir o corpo da resposta", async () => {
  const responseThatRejects = (error: unknown): Response =>
    ({
      ok: true,
      json: () => Promise.reject(error),
    }) as Response;
  const timeoutProvider = providerWithFetch(() =>
    Promise.resolve(
      responseThatRejects(new DOMException("timeout", "TimeoutError")),
    )
  );
  const networkProvider = providerWithFetch(() =>
    Promise.resolve(responseThatRejects(new TypeError("network")))
  );

  await expectProviderError(
    timeoutProvider.generate(request),
    "TIMEOUT",
    true,
  );
  await expectProviderError(
    networkProvider.generate(request),
    "NETWORK_ERROR",
    true,
  );
});

test("GeminiProvider não entrega conteúdo bloqueado por segurança", async () => {
  const promptBlockedProvider = providerWithFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          promptFeedback: { blockReason: "SAFETY" },
          candidates: [],
        }),
        { status: 200 },
      ),
    )
  );

  await expectProviderError(
    promptBlockedProvider.generate(request),
    "PROVIDER_REJECTED",
    false,
  );

  const partialCandidateProvider = providerWithFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "conteúdo parcial bloqueado" }] },
            finishReason: "SAFETY",
          }],
        }),
        { status: 200 },
      ),
    )
  );

  await expectProviderError(
    partialCandidateProvider.generate(request),
    "PROVIDER_REJECTED",
    false,
  );
});
