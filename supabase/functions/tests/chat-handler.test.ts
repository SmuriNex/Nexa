import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedPrincipal } from "../_shared/auth/authenticate.ts";
import type { ConversationStore } from "../_shared/conversations/conversation-service.ts";
import type { NexaCore } from "../_shared/core/nexa-core.ts";
import { handleChat } from "../chat/index.ts";

const principal: AuthenticatedPrincipal = {
  userId: "729a595f-0ac2-49dd-ad04-b3cdf7e4122b",
  accessToken: "test.token.value",
  connection: { url: "http://127.0.0.1:54321", publishableKey: "test-only-public-key" },
};

async function withMockRuntime<T>(run: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Deno");
  Object.defineProperty(globalThis, "Deno", {
    configurable: true,
    value: {
      env: { get: (name: string) => name === "NEXA_PRIMARY_PROVIDER" ? "mock" : undefined },
    },
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "Deno", previous);
    else Reflect.deleteProperty(globalThis, "Deno");
  }
}

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://local.test/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ app: "nexa", message: "Olá" }),
  });
}

test("chat bloqueia requisição sem usuário antes de criar store ou chamar IA", async () => {
  await withMockRuntime(async () => {
    let storeCalls = 0;
    let coreCalls = 0;
    const response = await handleChat(post(), {
      storeFactory: () => {
        storeCalls += 1;
        throw new Error("store não deveria ser criado");
      },
      coreFactory: () => {
        coreCalls += 1;
        throw new Error("core não deveria ser criado");
      },
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHORIZED");
    assert.equal(storeCalls, 0);
    assert.equal(coreCalls, 0);
  });
});

test("preflight aplica allowlist antes da autenticação", async () => {
  await withMockRuntime(async () => {
    let authCalls = 0;
    const dependencies = {
      authenticate: () => {
        authCalls += 1;
        return Promise.resolve(principal);
      },
    };
    const preflight = await handleChat(
      new Request("http://local.test/chat", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" },
      }),
      dependencies,
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");

    const denied = await handleChat(
      new Request("http://local.test/chat", {
        method: "OPTIONS",
        headers: { Origin: "https://example.invalid" },
      }),
      dependencies,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal((await denied.json()).error.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(authCalls, 0);
  });
});

test("chat rejeita stream acima de 32 KiB com 413 antes de criar store ou Core", async () => {
  await withMockRuntime(async () => {
    let storeCalls = 0;
    let coreCalls = 0;
    const request = new Request("http://local.test/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "oversized-stream",
      },
      body: JSON.stringify({ app: "nexa", message: "x".repeat(32_768) }),
    });
    assert.equal(request.headers.get("content-length"), null);

    const response = await handleChat(request, {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => {
        storeCalls += 1;
        throw new Error("store não deveria ser criado");
      },
      coreFactory: () => {
        coreCalls += 1;
        throw new Error("Core não deveria ser criado");
      },
    });
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
    assert.equal(body.request_id, "oversized-stream");
    assert.equal(storeCalls, 0);
    assert.equal(coreCalls, 0);
  });
});

test("chat responde 429 com Retry-After sem chamar provider nem persistir", async () => {
  await withMockRuntime(async () => {
    let coreFactoryCalls = 0;
    let providerCalls = 0;
    let commitCalls = 0;
    const store = {
      consumeRateLimit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 12 }),
      commitTurn: () => {
        commitCalls += 1;
        return Promise.resolve();
      },
    } as unknown as ConversationStore;
    const response = await handleChat(post({ "x-request-id": "req-rate-limited" }), {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
      coreFactory: () => {
        coreFactoryCalls += 1;
        return {
          chat: () => {
            providerCalls += 1;
            return Promise.resolve({
              reply: "Resposta",
              app: "nexa",
              provider: "mock",
              model: "mock",
              requestId: "req-rate-limited",
            });
          },
        } as unknown as NexaCore;
      },
    });

    assert.equal(coreFactoryCalls, 1);
    assert.equal(providerCalls, 0);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "12");
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.equal(commitCalls, 0);
  });
});
