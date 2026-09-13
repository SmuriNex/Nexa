import assert from "node:assert/strict";
import test from "node:test";

import { authenticateRequest, readSupabaseConnection } from "../_shared/auth/authenticate.ts";
import type { EnvironmentReader } from "../_shared/config/config.ts";
import { NexaError } from "../_shared/errors/nexa-error.ts";

const userId = "57b24188-6cb9-4cbb-a82b-59ebcfbd2c41";
const token = "header.payload.signature";
const reader: EnvironmentReader = {
  get: (name) =>
    ({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "test-only-public-key",
      SUPABASE_ANON_KEY: "test-only-legacy-key",
    })[name],
};

function request(authorization?: string): Request {
  return new Request("http://local.test/chat", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

async function expectError(promise: Promise<unknown>, code: string, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NexaError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.doesNotMatch(error.message, /test-only|header\.payload\.signature/);
    return true;
  });
}

test("Auth exige JWT de usuário antes de consultar Supabase", async () => {
  let fetchCalls = 0;
  const fetch = () => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (
    const authorization of [
      undefined,
      "Bearer test-only-public-key",
      "Basic abc",
      "Bearer a.b",
      "Bearer a.b.c extra",
    ]
  ) {
    await expectError(
      authenticateRequest(request(authorization), { reader, fetch }),
      "UNAUTHORIZED",
      401,
    );
  }
  assert.equal(fetchCalls, 0);
});

test("Auth valida token no endpoint do usuário e preserva identidade verificada", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const principal = await authenticateRequest(request(`Bearer ${token}`), {
    reader,
    fetch: (input, init) => {
      calledUrl = String(input);
      calledInit = init;
      return Promise.resolve(new Response(JSON.stringify({ id: userId }), { status: 200 }));
    },
  });

  assert.equal(calledUrl, "http://127.0.0.1:54321/auth/v1/user");
  assert.equal(new Headers(calledInit?.headers).get("apikey"), "test-only-public-key");
  assert.equal(new Headers(calledInit?.headers).get("authorization"), `Bearer ${token}`);
  assert.equal(principal.userId, userId);
  assert.equal(principal.accessToken, token);
  assert.equal(principal.connection.publishableKey, "test-only-public-key");
});

test("Auth rejeita token revogado e resposta sem usuário válido", async () => {
  await expectError(
    authenticateRequest(request(`Bearer ${token}`), {
      reader,
      fetch: () => Promise.resolve(new Response("denied", { status: 401 })),
    }),
    "UNAUTHORIZED",
    401,
  );

  await expectError(
    authenticateRequest(request(`Bearer ${token}`), {
      reader,
      fetch: () =>
        Promise.resolve(new Response(JSON.stringify({ id: "not-a-uuid" }), { status: 200 })),
    }),
    "AUTH_UNAVAILABLE",
    503,
  );

  await expectError(
    authenticateRequest(request(`Bearer ${token}`), {
      reader,
      fetch: () => Promise.reject(new Error("sensitive transport detail")),
    }),
    "AUTH_UNAVAILABLE",
    503,
  );
});

test("Auth rejeita configuração de URL com credenciais ou query", () => {
  for (
    const url of [
      "https://user:password@local.test",
      "https://local.test/?secret=1",
      "ftp://local.test",
    ]
  ) {
    assert.throws(
      () => readSupabaseConnection({ get: (name) => name === "SUPABASE_URL" ? url : "public-key" }),
      (error: unknown) => error instanceof NexaError && error.code === "CONFIGURATION_ERROR",
    );
  }
});
