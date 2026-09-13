import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedPrincipal } from "../_shared/auth/authenticate.ts";
import { SupabaseConversationStore } from "../_shared/conversations/supabase-store.ts";
import { NexaError } from "../_shared/errors/nexa-error.ts";

const userId = "63ca514e-a44d-4b92-9e3d-94b79fc499c6";
const conversationId = "1d6068c7-e47a-46b8-8e86-02708f7e274f";
const userMessageId = "2f2eacb7-9e43-41f1-a255-aeaf5b4849c1";
const assistantMessageId = "766f0d86-cd6c-4889-907f-cebd3ac31107";

function principal(
  serviceRoleKey: string | null = "test-only-service-role",
): AuthenticatedPrincipal {
  return {
    userId,
    accessToken: "header.payload.signature",
    connection: {
      url: "http://127.0.0.1:54321",
      publishableKey: "test-only-public-key",
      ...(serviceRoleKey ? { serviceRoleKey } : {}),
    },
  };
}

test("leituras PostgREST usam somente JWT do usuário e chave pública", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const store = new SupabaseConversationStore(principal(), (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  });

  assert.deepEqual(await store.listConversations(2, 3), []);
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("apikey"), "test-only-public-key");
  assert.equal(headers.get("authorization"), "Bearer header.payload.signature");
  assert.doesNotMatch(String(capturedInit?.body ?? ""), /service-role/);
  assert.match(capturedUrl, /\/rest\/v1\/conversations\?/);
  assert.match(capturedUrl, /limit=2/);
  assert.match(capturedUrl, /offset=3/);
});

test("histórico recente é consultado em ordem reversa e normalizado cronologicamente", async () => {
  let capturedUrl = "";
  const store = new SupabaseConversationStore(principal(), (input) => {
    capturedUrl = String(input);
    return Promise.resolve(
      new Response(
        JSON.stringify([
          { role: "assistant", content: "Resposta" },
          { role: "user", content: "Pergunta" },
        ]),
        { status: 200 },
      ),
    );
  });

  assert.deepEqual(await store.getRecentMessages(conversationId, 8), [
    { role: "user", content: "Pergunta" },
    { role: "assistant", content: "Resposta" },
  ]);
  assert.match(capturedUrl, /\/rest\/v1\/messages\?/);
  assert.match(capturedUrl, /limit=8/);
  assert.match(capturedUrl, /order=created_at.desc%2Cid.desc/);
});

test("commit atômico usa credencial server-side e identidade já autenticada", async () => {
  let capturedInit: RequestInit | undefined;
  const store = new SupabaseConversationStore(principal(), (_input, init) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify([{
          conversation_id: conversationId,
          user_message_id: userMessageId,
          assistant_message_id: assistantMessageId,
        }]),
        { status: 200 },
      ),
    );
  });

  await store.commitTurn({
    conversationId,
    createNew: true,
    app: "nexa",
    userContent: "Pergunta",
    assistantContent: "Resposta",
    provider: "mock",
    model: "mock",
    requestId: "request-safe",
  });

  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("apikey"), "test-only-service-role");
  assert.equal(headers.get("authorization"), "Bearer test-only-service-role");
  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.equal(body.p_user_id, userId);
  assert.equal(body.p_conversation_id, conversationId);
});

test("commit falha fechado quando a credencial server-side não existe", async () => {
  let fetchCalls = 0;
  const store = new SupabaseConversationStore(principal(null), () => {
    fetchCalls += 1;
    return Promise.resolve(new Response("[]", { status: 200 }));
  });

  await assert.rejects(
    store.commitTurn({
      conversationId,
      createNew: true,
      app: "nexa",
      userContent: "Pergunta",
      assistantContent: "Resposta",
      provider: "mock",
      model: "mock",
      requestId: "request-safe",
    }),
    (error: unknown) => error instanceof NexaError && error.code === "CONFIGURATION_ERROR",
  );
  assert.equal(fetchCalls, 0);
});
