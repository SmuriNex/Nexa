import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedPrincipal } from "../_shared/auth/authenticate.ts";
import { boundMemoriesForChat, SupabaseMemoryStore } from "../_shared/memories/supabase-store.ts";
import type { MemoryRecord } from "../_shared/memories/types.ts";

const principal: AuthenticatedPrincipal = {
  userId: "729a595f-0ac2-49dd-ad04-b3cdf7e4122b",
  accessToken: "user.jwt.value",
  connection: {
    url: "http://127.0.0.1:54321",
    publishableKey: "public-key",
    serviceRoleKey: "forbidden-service-role",
  },
};

function memory(index = 0, content = `memória-${index}`): MemoryRecord {
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    scope: index % 2 === 0 ? "global" : "app",
    app: index % 2 === 0 ? null : "nexa",
    category: "fact",
    content,
    source: "user_explicit",
    created_at: `2026-09-13T12:00:${String(index).padStart(2, "0")}Z`,
    updated_at: `2026-09-13T12:00:${String(index).padStart(2, "0")}Z`,
  };
}

test("Memory store usa apenas JWT e chave pública e não escreve identidade ou source", async () => {
  const calls: Array<{ input: string; init: RequestInit; body: unknown }> = [];
  const store = new SupabaseMemoryStore(principal, (input, init = {}) => {
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ input: String(input), init, body });
    return Promise.resolve(new Response(JSON.stringify([memory()]), { status: 200 }));
  });

  await store.createMemory({
    scope: "global",
    app: null,
    category: "preference",
    content: "Resposta curta",
  });
  await store.updateMemory(memory().id, {
    scope: "app",
    app: "erp",
    category: "instruction",
    content: "Use português",
  });

  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].init.method, "PATCH");
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("apikey"), principal.connection.publishableKey);
    assert.equal(headers.get("authorization"), `Bearer ${principal.accessToken}`);
    assert.doesNotMatch(JSON.stringify(call), /forbidden-service-role/);
    assert.equal(Object.hasOwn(call.body as object, "user_id"), false);
    assert.equal(Object.hasOwn(call.body as object, "source"), false);
  }
});

test("Memory store consulta somente global e app atual em ordem e limites determinísticos", async () => {
  const rows = Array.from({ length: 6 }, (_, index) => memory(index, String(index).repeat(2_000)));
  let requested = "";
  const store = new SupabaseMemoryStore(principal, (input) => {
    requested = String(input);
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  });

  const result = await store.listForChat("nexa");
  const url = new URL(requested);
  assert.equal(url.searchParams.get("user_id"), `eq.${principal.userId}`);
  assert.equal(url.searchParams.get("or"), "(scope.eq.global,and(scope.eq.app,app.eq.nexa))");
  assert.equal(url.searchParams.get("order"), "updated_at.desc,id.desc");
  assert.equal(url.searchParams.get("limit"), "12");
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.content[0]), ["0", "1", "2"]);
  assert.equal(result.reduce((total, item) => total + item.content.length, 0), 6_000);
});

test("Memory context mantém um prefixo das 12 entradas mais recentes", () => {
  const rows = Array.from({ length: 15 }, (_, index) => memory(index));
  const bounded = boundMemoriesForChat(rows);
  assert.equal(bounded.length, 12);
  assert.deepEqual(
    bounded.map((item) => item.content),
    rows.slice(0, 12).map((item) => item.content),
  );
});
