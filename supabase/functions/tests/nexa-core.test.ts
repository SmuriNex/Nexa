import assert from "node:assert/strict";
import test from "node:test";

import { GroqProvider } from "../_shared/ai/groq-provider.ts";
import { createAIProvider } from "../_shared/ai/provider-factory.ts";
import type { AIProvider } from "../_shared/ai/provider.ts";
import { DEFAULT_GROQ_MODEL, loadNexaConfig, type NexaConfig } from "../_shared/config/config.ts";
import { resolveContext } from "../_shared/context/context-resolver.ts";
import { NexaCore } from "../_shared/core/nexa-core.ts";
import { NexaError } from "../_shared/errors/nexa-error.ts";
import { ProviderError } from "../_shared/errors/provider-error.ts";
import { corsHeaders, ensureOriginAllowed } from "../_shared/http/cors.ts";
import { buildInstructions } from "../_shared/instructions/instruction-builder.ts";
import { resolveRequestId } from "../_shared/request/request-id.ts";
import { MAX_MESSAGE_LENGTH } from "../_shared/validation/chat-request.ts";
import { handleChat } from "../chat/index.ts";

const quietLogger = () => undefined;

function config(values: Record<string, string> = {}): NexaConfig {
  const explicitValues = "NEXA_PRIMARY_PROVIDER" in values || "NEXA_AI_PROVIDER" in values
    ? values
    : { NEXA_PRIMARY_PROVIDER: "mock", ...values };
  return loadNexaConfig({ get: (name) => explicitValues[name] });
}

function mockCore(customConfig = config()): NexaCore {
  return new NexaCore(customConfig, {
    logger: quietLogger,
    providerFactory: () => createAIProvider(customConfig),
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NexaError);
    assert.equal(error.code, code);
    return true;
  });
}

test("processa o contexto nexa com MockProvider", async () => {
  const result = await mockCore().chat({ app: "nexa", message: "Olá Nexa" });
  assert.deepEqual(
    { reply: result.reply, app: result.app, provider: result.provider, model: result.model },
    {
      reply: "Nexa Mock recebeu sua mensagem no contexto nexa.",
      app: "nexa",
      provider: "mock",
      model: "mock",
    },
  );
});

test("processa o contexto ascent com MockProvider", async () => {
  const result = await mockCore().chat({ app: "ascent", message: "Treino" });
  assert.equal(result.app, "ascent");
  assert.match(result.reply, /contexto ascent/);
});

test("processa o contexto erp com MockProvider", async () => {
  const result = await mockCore().chat({ app: "erp", message: "Ajuda" });
  assert.equal(result.app, "erp");
  assert.match(result.reply, /contexto erp/);
});

test("rejeita aplicativo desconhecido", async () => {
  await expectCode(mockCore().chat({ app: "outro", message: "Olá" }), "INVALID_APP");
});

test("rejeita mensagem vazia", async () => {
  await expectCode(mockCore().chat({ app: "nexa", message: "   " }), "EMPTY_MESSAGE");
});

test("rejeita mensagem acima do limite", async () => {
  await expectCode(
    mockCore().chat({ app: "nexa", message: "x".repeat(MAX_MESSAGE_LENGTH + 1) }),
    "MESSAGE_TOO_LONG",
  );
});

test("rejeita context que não seja objeto", async () => {
  await expectCode(
    mockCore().chat({ app: "nexa", message: "Olá", context: [] }),
    "INVALID_CONTEXT",
  );
});

test("rejeita provider inexistente", () => {
  assert.throws(
    () => config({ NEXA_PRIMARY_PROVIDER: "inexistente" }),
    (error: unknown) => error instanceof NexaError && error.code === "CONFIGURATION_ERROR",
  );
});

test("normaliza falha simulada do provider", async () => {
  const failingProvider: AIProvider = {
    name: "failure-test",
    model: "failure-test",
    generate() {
      return Promise.reject(
        new NexaError(
          "AI_PROVIDER_UNAVAILABLE",
          "O provedor de IA está temporariamente indisponível.",
          503,
        ),
      );
    },
  };
  const core = new NexaCore(config(), {
    logger: quietLogger,
    providerFactory: () => failingProvider,
  });

  await expectCode(
    core.chat({ app: "nexa", message: "Olá" }),
    "AI_PROVIDER_UNAVAILABLE",
  );
});

test("normaliza resposta do provider e usa metadados internos", async () => {
  const provider: AIProvider = {
    name: "stub",
    model: "stub-model",
    generate: () => Promise.resolve({ reply: "  resposta normalizada  " }),
  };
  const core = new NexaCore(config(), {
    logger: quietLogger,
    providerFactory: () => provider,
  });

  const result = await core.chat({ app: "nexa", message: "Olá" });
  assert.equal(result.reply, "resposta normalizada");
  assert.equal(result.provider, "stub");
  assert.equal(result.model, "stub-model");
});

test("seleciona instruções corretas e mantém identidade fora do provider", () => {
  const ascent = buildInstructions(resolveContext("ascent"));
  const erp = buildInstructions(resolveContext("erp"));
  assert.match(ascent, /inteligência artificial da NexPoint/);
  assert.match(ascent, /Coach do Ascent/);
  assert.match(ascent, /diagnósticos médicos/);
  assert.match(erp, /suporte técnico básico do ERP/);
  assert.match(erp, /não finja ter consultado banco/);
});

test("preserva request ID válido e substitui valor inválido", async () => {
  const supplied = await mockCore().chat(
    { app: "nexa", message: "Olá" },
    "req-local-123",
  );
  assert.equal(supplied.requestId, "req-local-123");

  const generated = resolveRequestId("valor inválido com espaços");
  assert.match(generated, /^[0-9a-f-]{36}$/);
});

test("CORS aplica a origem permitida exata e rejeita wildcard na configuração", () => {
  const localConfig = config({
    NEXA_ALLOWED_ORIGINS: "http://localhost:3000",
  });
  const request = new Request("http://local.test/chat", {
    headers: { Origin: "http://localhost:3000" },
  });

  ensureOriginAllowed(request, localConfig);
  assert.equal(
    corsHeaders(request, localConfig, ["POST"]).get(
      "Access-Control-Allow-Origin",
    ),
    "http://localhost:3000",
  );
  assert.throws(
    () => config({ NEXA_ALLOWED_ORIGINS: "*" }),
    (error: unknown) =>
      error instanceof NexaError &&
      error.code === "CONFIGURATION_ERROR",
  );
});

test("CORS rejeita origem não permitida", () => {
  const request = new Request("http://local.test/chat", {
    headers: { Origin: "https://example.invalid" },
  });

  assert.throws(
    () => ensureOriginAllowed(request, config()),
    (error: unknown) =>
      error instanceof NexaError &&
      error.code === "ORIGIN_NOT_ALLOWED",
  );
});

test("adaptador HTTP exige media type application/json exato", async () => {
  const previousRuntime = Object.getOwnPropertyDescriptor(globalThis, "Deno");
  Object.defineProperty(globalThis, "Deno", {
    configurable: true,
    value: {
      env: { get: (name: string) => name === "NEXA_PRIMARY_PROVIDER" ? "mock" : undefined },
    },
  });

  try {
    const response = await handleChat(
      new Request("http://local.test/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/jsonp",
          "x-request-id": "media-type-test",
        },
        body: JSON.stringify({ app: "nexa", message: "Olá" }),
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 415);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "UNSUPPORTED_MEDIA_TYPE");
    assert.equal(body.request_id, "media-type-test");
  } finally {
    if (previousRuntime) {
      Object.defineProperty(globalThis, "Deno", previousRuntime);
    } else {
      Reflect.deleteProperty(globalThis, "Deno");
    }
  }
});

test("GroqProvider exige chave somente quando selecionado", async () => {
  const provider = new GroqProvider({
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
  });
  await expectCode(
    provider.generate({
      app: "nexa",
      message: "Olá",
      instructions: "Instruções",
      requestId: "req-test",
    }),
    "AI_PROVIDER_NOT_CONFIGURED",
  );
});

test("GroqProvider usa endpoint fixo e normaliza resposta sem SDK", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "  resposta Groq  " } }],
          }),
          { status: 200 },
        ),
      );
    },
  });

  const result = await provider.generate({
    app: "ascent",
    message: "Olá",
    instructions: "Identidade e contexto",
    context: { objetivo: "força" },
    requestId: "req-test",
  });

  assert.equal(capturedUrl, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(result.reply, "resposta Groq");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, DEFAULT_GROQ_MODEL);
  assert.equal(body.tool_choice, "none");
  assert.equal(body.include_reasoning, false);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /objetivo/);
});

test("GroqProvider não expõe corpo de erro HTTP", async () => {
  const provider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () => Promise.resolve(new Response("secret upstream detail", { status: 500 })),
  });

  await assert.rejects(
    provider.generate({
      app: "nexa",
      message: "Olá",
      instructions: "Instruções",
      requestId: "req-test",
    }),
    (error: unknown) => {
      assert.ok(error instanceof NexaError);
      assert.equal(error.code, "AI_PROVIDER_UNAVAILABLE");
      assert.doesNotMatch(error.message, /secret upstream detail/);
      return true;
    },
  );
});

test("GroqProvider rejeita resposta inválida", async () => {
  const provider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () => Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 })),
  });

  await expectCode(
    provider.generate({
      app: "nexa",
      message: "Olá",
      instructions: "Instruções",
      requestId: "req-test",
    }),
    "AI_PROVIDER_INVALID_RESPONSE",
  );
});

test("GroqProvider classifica falha ao consumir o corpo da resposta", async () => {
  const request = {
    app: "nexa" as const,
    message: "Olá",
    instructions: "Instruções",
    requestId: "req-test",
  };
  const responseThatRejects = (error: unknown): Response =>
    ({
      ok: true,
      json: () => Promise.reject(error),
    }) as Response;
  const timeoutProvider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () =>
      Promise.resolve(
        responseThatRejects(new DOMException("timeout", "TimeoutError")),
      ),
  });
  const networkProvider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () => Promise.resolve(responseThatRejects(new TypeError("network"))),
  });

  await assert.rejects(
    timeoutProvider.generate(request),
    (error: unknown) => error instanceof ProviderError && error.kind === "TIMEOUT",
  );
  await assert.rejects(
    networkProvider.generate(request),
    (error: unknown) => error instanceof ProviderError && error.kind === "NETWORK_ERROR",
  );
});

test("GroqProvider distingue timeout e falha de rede", async () => {
  const request = {
    app: "nexa" as const,
    message: "Olá",
    instructions: "Instruções",
    requestId: "req-test",
  };
  const timeoutProvider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () => Promise.reject(new DOMException("timeout", "TimeoutError")),
  });
  const networkProvider = new GroqProvider({
    apiKey: "test-only-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () => Promise.reject(new TypeError("network detail")),
  });

  await expectCode(timeoutProvider.generate(request), "AI_PROVIDER_TIMEOUT");
  await expectCode(networkProvider.generate(request), "AI_PROVIDER_UNAVAILABLE");
});
