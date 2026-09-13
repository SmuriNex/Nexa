import { strict as assert } from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NPX_CLI = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
const RUN = process.env.NEXA_RUN_LOCAL_INTEGRATION === "1";
const EXPECTED_API_PORT = "54421";
const RATE_LIMIT = 6;
const WAIT_MS = 30_000;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function check(value, message) {
  assert.ok(value, message);
}

function isLocalUrl(raw, path = "") {
  const url = new URL(raw);
  return url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port === EXPECTED_API_PORT && url.pathname.endsWith(path);
}

function localStatus() {
  let raw;
  try {
    if (process.platform === "win32" && !existsSync(NPX_CLI)) {
      throw new Error("npx indisponível");
    }
    raw = process.platform === "win32"
      ? execFileSync(process.execPath, [NPX_CLI, "supabase", "status", "-o", "json"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: WAIT_MS,
        windowsHide: true,
      })
      : execFileSync("npx", ["supabase", "status", "-o", "json"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: WAIT_MS,
      });
  } catch {
    throw new Error("Supabase Local indisponível para o teste de integração.");
  }

  let status;
  try {
    status = JSON.parse(raw);
  } catch {
    throw new Error("Supabase Local não retornou status JSON válido.");
  }
  check(isLocalUrl(status.API_URL), "O API_URL não é o stack local da Nexa.");
  check(
    isLocalUrl(status.FUNCTIONS_URL, "/functions/v1"),
    "O FUNCTIONS_URL não é o stack local da Nexa.",
  );
  check(
    typeof status.ANON_KEY === "string" && status.ANON_KEY,
    "Anon key local ausente.",
  );
  check(
    typeof status.SERVICE_ROLE_KEY === "string" && status.SERVICE_ROLE_KEY,
    "Service role key local ausente para cleanup.",
  );
  return status;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(
  status,
  path,
  { method = "GET", token, body, origin, prefer } = {},
) {
  const headers = new Headers({
    apikey: status.ANON_KEY,
    Accept: "application/json",
  });
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (origin) headers.set("Origin", origin);
  if (prefer) headers.set("Prefer", prefer);
  const response = await fetch(new URL(path, status.API_URL), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(WAIT_MS),
  });
  return { response, body: await safeJson(response) };
}

async function functionRequest(status, name, path = "", options = {}) {
  const url = new URL(`${status.FUNCTIONS_URL}/${name}${path}`);
  const headers = new Headers({
    apikey: status.ANON_KEY,
    Accept: "application/json",
  });
  if (options.token !== undefined) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.origin) headers.set("Origin", options.origin);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(WAIT_MS),
  });
  return { response, body: await safeJson(response) };
}

async function publicFunctionRequest(status, name, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(new URL(`${status.FUNCTIONS_URL}/${name}`), {
        ...options,
        signal: AbortSignal.timeout(WAIT_MS),
      });
    } catch {
      if (attempt === 2) break;
      await sleep(400);
    }
  }
  throw new Error(
    `A função pública ${name} não respondeu após três tentativas.`,
  );
}

async function createLocalUser(status, cleanupIds) {
  const email = `nexa-int-${randomUUID()}@example.test`;
  const password = `A1a!${randomBytes(24).toString("base64url")}`;
  const signup = await request(status, "/auth/v1/signup", {
    method: "POST",
    body: { email, password },
  });
  check(
    signup.response.ok,
    `Signup local falhou: HTTP ${signup.response.status}.`,
  );
  const id = signup.body?.user?.id ?? signup.body?.id;
  check(typeof id === "string", "Signup local não retornou user id.");
  cleanupIds.push(id);
  const login = await request(status, "/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  check(
    login.response.ok,
    `Login local falhou: HTTP ${login.response.status}.`,
  );
  const token = login.body?.access_token;
  check(
    typeof token === "string" && token.length > 0,
    "Login local não retornou JWT.",
  );
  return { id, token };
}

async function deleteLocalUser(status, id) {
  const response = await fetch(
    new URL(`/auth/v1/admin/users/${id}`, status.API_URL),
    {
      method: "DELETE",
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(WAIT_MS),
    },
  );
  return response.ok;
}

async function stopServe(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10_000,
    });
  } else {
    child.kill("SIGTERM");
  }
  await sleep(500);
}

async function startServe(status, envFile) {
  const command = process.platform === "win32" ? process.execPath : "npx";
  const args = [
    ...(process.platform === "win32" ? [NPX_CLI] : []),
    "supabase",
    "functions",
    "serve",
    "--env-file",
    envFile,
  ];
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let ready = false;
  let recentOutput = "";
  const observe = (chunk) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-8_192);
    if (/serving functions|functions.*ready|listening on/i.test(recentOutput)) {
      ready = true;
    }
  };
  child.stdout.on("data", observe);
  child.stderr.on("data", observe);
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        "O runtime temporário de Edge Functions terminou antes de ficar pronto.",
      );
    }
    if (ready) {
      try {
        const health = await functionRequest(status, "health");
        if (health.response.status === 200) {
          await sleep(800);
          const settled = await functionRequest(status, "health");
          if (settled.response.status === 200) return child;
        }
      } catch {
        // O gateway pode aceitar a rota somente alguns instantes depois do runtime.
      }
    }
    await sleep(300);
  }
  await stopServe(child);
  throw new Error("O runtime temporário de Edge Functions não ficou pronto.");
}

function dataRows(body, name) {
  const data = body?.data;
  return Array.isArray(data) ? data : data?.[name];
}

async function restRows(status, table, token, filter) {
  const result = await request(status, `/rest/v1/${table}?select=*&${filter}`, {
    token,
  });
  check(
    result.response.status === 200,
    `REST ${table} falhou: HTTP ${result.response.status}.`,
  );
  check(Array.isArray(result.body), `REST ${table} não retornou lista.`);
  return result.body;
}

test(
  "Auth, RLS, chat e rate limit no Supabase Local",
  { skip: !RUN },
  async (t) => {
    const config = await readFile(
      join(ROOT, "supabase", "config.toml"),
      "utf8",
    );
    check(
      /^project_id\s*=\s*"Nexa"\s*$/m.test(config),
      "O projeto local não é Nexa.",
    );
    const status = localStatus();
    const tempDir = await mkdtemp(join(tmpdir(), "nexa-local-integration-"));
    const mockFile = join(tempDir, "mock.env");
    const noKeyFile = join(tempDir, "no-key.env");
    const users = [];
    let serve;
    let conversationA;
    let conversationB;
    let userA;
    let userB;
    try {
      await writeFile(
        mockFile,
        `NEXA_ENV=test\nNEXA_PRIMARY_PROVIDER=mock\nNEXA_RATE_LIMIT_PER_MINUTE=${RATE_LIMIT}\nNEXA_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000\nGROQ_API_KEY=\nGEMINI_API_KEY=\n`,
        { mode: 0o600 },
      );
      await writeFile(
        noKeyFile,
        `NEXA_ENV=test\nNEXA_PRIMARY_PROVIDER=groq\nNEXA_RATE_LIMIT_PER_MINUTE=${RATE_LIMIT}\nNEXA_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000\nGROQ_API_KEY=\nGEMINI_API_KEY=\n`,
        { mode: 0o600 },
      );
      serve = await startServe(status, mockFile);

      await t.test("health público e preflight", async () => {
        const direct = await publicFunctionRequest(status, "health");
        check(
          direct.status === 200,
          `Health público retornou HTTP ${direct.status}.`,
        );
        const preflight = await publicFunctionRequest(status, "chat", {
          method: "OPTIONS",
          headers: {
            Origin: "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,apikey,content-type",
          },
        });
        check(preflight.ok, `Preflight retornou HTTP ${preflight.status}.`);
        t.diagnostic(
          `CORS preflight pelo gateway: wildcard=${
            preflight.headers.get("access-control-allow-origin") === "*"
          }`,
        );
      });

      userA = await createLocalUser(status, users);
      userB = await createLocalUser(status, users);

      await t.test("JWT ausente, inválido e válido", async () => {
        const body = { app: "nexa", message: "Teste Auth" };
        const missing = await functionRequest(status, "chat", "", {
          method: "POST",
          body,
        });
        check(
          [401, 403].includes(missing.response.status),
          "Chat aceitou JWT ausente.",
        );
        const invalid = await functionRequest(status, "chat", "", {
          method: "POST",
          token: "invalid.jwt.token",
          body,
        });
        check(
          [401, 403].includes(invalid.response.status),
          "Chat aceitou JWT inválido.",
        );
        const valid = await request(status, "/auth/v1/user", {
          token: userA.token,
        });
        check(
          valid.response.status === 200,
          "JWT válido não autenticou User A.",
        );
        check(
          valid.body?.id === userA.id,
          "JWT válido resolveu identidade incorreta.",
        );
      });

      let chatSucceeded = false;
      await t.test("Chat persistente de User A e isolamento por app", async () => {
        const first = await functionRequest(status, "chat", "", {
          method: "POST",
          token: userA.token,
          body: { app: "nexa", message: "Primeira mensagem fictícia" },
        });
        if (first.response.status !== 200) {
          t.diagnostic(
            `Primeiro chat: código seguro=${first.body?.error?.code ?? "ausente"}.`,
          );
          const quotaProbe = await request(
            status,
            "/rest/v1/rpc/nexa_consume_rate_limit",
            {
              method: "POST",
              token: userA.token,
              body: { p_window_seconds: 60, p_max_requests: RATE_LIMIT },
            },
          );
          t.diagnostic(
            `RPC rate limit: HTTP ${quotaProbe.response.status}, código DB=${
              quotaProbe.body?.code ?? "ausente"
            }.`,
          );
        }
        check(
          first.response.status === 200,
          `Primeiro chat retornou HTTP ${first.response.status}.`,
        );
        check(first.body?.ok === true, "Primeiro chat não retornou sucesso.");
        check(
          first.body?.data?.provider === "mock",
          "Chat não usou MockProvider.",
        );
        check(
          typeof first.body?.data?.reply === "string",
          "Chat não retornou resposta.",
        );
        conversationA = first.body?.data?.conversation_id;
        check(
          typeof conversationA === "string",
          "Chat não retornou conversation_id.",
        );

        const second = await functionRequest(status, "chat", "", {
          method: "POST",
          token: userA.token,
          body: {
            app: "nexa",
            message: "Segunda mensagem fictícia",
            conversation_id: conversationA,
          },
        });
        check(
          second.response.status === 200,
          `Segundo chat retornou HTTP ${second.response.status}.`,
        );
        check(
          second.body?.data?.conversation_id === conversationA,
          "Chat não reutilizou conversa.",
        );
        check(
          second.body?.data?.reply?.includes("Continuidade: 2 mensagens anteriores."),
          "Provider não recebeu o histórico persistido do primeiro turno.",
        );

        const detail = await functionRequest(
          status,
          "conversations",
          `/${conversationA}?limit=10&offset=0`,
          {
            token: userA.token,
          },
        );
        if (detail.response.status !== 200) {
          t.diagnostic(
            `Detalhe da conversa: HTTP ${detail.response.status}, código seguro=${
              detail.body?.error?.code ?? "ausente"
            }.`,
          );
        }
        check(
          detail.response.status === 200,
          "User A não obteve detalhe da própria conversa.",
        );
        const messages = dataRows(detail.body, "messages");
        check(
          Array.isArray(messages) && messages.length === 4,
          "Turnos não foram persistidos.",
        );
        check(
          messages.map((item) => item.role).join(",") ===
            "user,assistant,user,assistant",
          "Ordem dos turnos persistidos está incorreta.",
        );

        const mismatch = await functionRequest(status, "chat", "", {
          method: "POST",
          token: userA.token,
          body: {
            app: "erp",
            message: "Tentativa de trocar app",
            conversation_id: conversationA,
          },
        });
        check(
          mismatch.response.status === 409,
          "Conversa aceitou troca de app.",
        );
        const after = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${conversationA}`,
        );
        check(after.length === 4, "Troca de app alterou mensagens.");
        const changeApp = await request(
          status,
          `/rest/v1/conversations?id=eq.${conversationA}`,
          {
            method: "PATCH",
            token: userA.token,
            body: { app: "erp" },
            prefer: "return=representation",
          },
        );
        check(
          !changeApp.response.ok ||
            (Array.isArray(changeApp.body) && changeApp.body.length === 0),
          "REST permitiu trocar o app de uma conversa.",
        );
        const stillNexa = await restRows(
          status,
          "conversations",
          userA.token,
          `id=eq.${conversationA}`,
        );
        check(
          stillNexa.length === 1 && stillNexa[0].app === "nexa",
          "App da conversa mudou.",
        );
        chatSucceeded = true;
      });
      if (!chatSucceeded) return;

      await t.test("User A atualiza título e exclui conversa própria com cascade", async () => {
        const update = await request(
          status,
          `/rest/v1/conversations?id=eq.${conversationA}`,
          {
            method: "PATCH",
            token: userA.token,
            body: { title: "Título local atualizado" },
            prefer: "return=representation",
          },
        );
        check(update.response.status === 200, "User A não atualizou a própria conversa.");
        check(
          Array.isArray(update.body) && update.body[0]?.title === "Título local atualizado",
          "Atualização de título próprio não foi persistida.",
        );

        const create = await functionRequest(status, "chat", "", {
          method: "POST",
          token: userA.token,
          body: { app: "ascent", message: "Conversa descartável para cascade" },
        });
        const disposableId = create.body?.data?.conversation_id;
        check(
          create.response.status === 200 && typeof disposableId === "string",
          "Chat descartável falhou.",
        );
        const deleted = await functionRequest(
          status,
          "conversations",
          `/${disposableId}`,
          { method: "DELETE", token: userA.token },
        );
        check(deleted.response.status === 200, "Endpoint não excluiu conversa própria.");
        check(deleted.body?.data?.deleted === true, "Exclusão não retornou confirmação.");
        const remainingConversations = await restRows(
          status,
          "conversations",
          userA.token,
          `id=eq.${disposableId}`,
        );
        const remainingMessages = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${disposableId}`,
        );
        check(remainingConversations.length === 0, "Conversa excluída permaneceu no banco.");
        check(remainingMessages.length === 0, "Cascade não removeu mensagens da conversa.");
      });

      await t.test("RLS com User A e User B", async () => {
        const ownA = await restRows(
          status,
          "conversations",
          userA.token,
          `id=eq.${conversationA}`,
        );
        check(ownA.length === 1, "User A não lê a própria conversa via RLS.");
        const otherB = await restRows(
          status,
          "conversations",
          userB.token,
          `id=eq.${conversationA}`,
        );
        check(otherB.length === 0, "User B lê a conversa de User A.");
        const messagesB = await restRows(
          status,
          "messages",
          userB.token,
          `conversation_id=eq.${conversationA}`,
        );
        check(messagesB.length === 0, "User B lê mensagens de User A.");
        const forgedOwner = await request(status, "/rest/v1/conversations", {
          method: "POST",
          token: userA.token,
          body: { user_id: userB.id, app: "nexa", title: "Ownership indevido" },
          prefer: "return=representation",
        });
        check(
          [400, 401, 403].includes(forgedOwner.response.status),
          "User A criou conversa com user_id de User B.",
        );
        const forgedAssistant = await request(status, "/rest/v1/messages", {
          method: "POST",
          token: userA.token,
          body: {
            conversation_id: conversationA,
            role: "assistant",
            content: "Resposta falsa",
          },
          prefer: "return=representation",
        });
        check(
          [400, 401, 403].includes(forgedAssistant.response.status),
          "User A inseriu resposta assistant diretamente.",
        );
        const beforeForgedRpc = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${conversationA}`,
        );
        const forgedRpc = await request(status, "/rest/v1/rpc/nexa_append_turn", {
          method: "POST",
          token: userA.token,
          body: {
            p_user_id: userA.id,
            p_conversation_id: conversationA,
            p_create_new: false,
            p_app: "nexa",
            p_user_content: "Turno direto indevido",
            p_assistant_content: "Resposta forjada",
            p_provider: "forged",
            p_model: "forged",
            p_request_id: "forged-request",
          },
        });
        check(
          [401, 403, 404].includes(forgedRpc.response.status),
          "User A chamou diretamente a RPC server-side de assistant.",
        );
        const afterForgedRpc = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${conversationA}`,
        );
        check(
          afterForgedRpc.length === beforeForgedRpc.length,
          "RPC direta autenticada forjou um turno assistant.",
        );

        const updateB = await request(
          status,
          `/rest/v1/conversations?id=eq.${conversationA}`,
          {
            method: "PATCH",
            token: userB.token,
            body: { title: "Título indevido" },
            prefer: "return=representation",
          },
        );
        check(updateB.response.ok, "UPDATE sob RLS falhou inesperadamente.");
        check(
          Array.isArray(updateB.body) && updateB.body.length === 0,
          "User B alterou conversa A.",
        );

        const insertB = await request(status, "/rest/v1/messages", {
          method: "POST",
          token: userB.token,
          body: {
            conversation_id: conversationA,
            role: "user",
            content: "Mensagem indevida",
          },
          prefer: "return=representation",
        });
        check(
          [400, 401, 403].includes(insertB.response.status),
          "User B inseriu mensagem na conversa A.",
        );

        const deleteB = await request(
          status,
          `/rest/v1/conversations?id=eq.${conversationA}`,
          {
            method: "DELETE",
            token: userB.token,
            prefer: "return=representation",
          },
        );
        check(deleteB.response.ok, "DELETE sob RLS falhou inesperadamente.");
        check(
          Array.isArray(deleteB.body) && deleteB.body.length === 0,
          "User B excluiu conversa A.",
        );
        const stillA = await restRows(
          status,
          "conversations",
          userA.token,
          `id=eq.${conversationA}`,
        );
        check(stillA.length === 1, "User B afetou a conversa A.");

        const detailB = await functionRequest(
          status,
          "conversations",
          `/${conversationA}`,
          {
            token: userB.token,
          },
        );
        check(
          [403, 404].includes(detailB.response.status),
          "User B obteve detalhe da conversa A.",
        );
        const deleteApiB = await functionRequest(
          status,
          "conversations",
          `/${conversationA}`,
          {
            method: "DELETE",
            token: userB.token,
          },
        );
        check(
          [403, 404].includes(deleteApiB.response.status),
          "User B excluiu conversa A pela API.",
        );
        const listB = await functionRequest(
          status,
          "conversations",
          "?limit=10&offset=0",
          {
            token: userB.token,
          },
        );
        check(
          listB.response.status === 200,
          "User B não pôde listar as próprias conversas.",
        );
        const rowsB = dataRows(listB.body, "conversations");
        check(Array.isArray(rowsB), "Listagem não retornou lista.");
        check(
          !rowsB.some((item) => item.id === conversationA),
          "Listagem de B incluiu conversa A.",
        );
      });

      await t.test("CORS bloqueia POST e GET de origem não autorizada", async () => {
        const badOrigin = "https://nexa-unauthorized.example";
        const chat = await functionRequest(status, "chat", "", {
          method: "POST",
          token: userA.token,
          origin: badOrigin,
          body: { app: "nexa", message: "CORS rejeitado" },
        });
        check(chat.response.status === 403, "Chat aceitou origem externa.");
        const conversations = await functionRequest(
          status,
          "conversations",
          "?limit=1",
          {
            token: userA.token,
            origin: badOrigin,
          },
        );
        check(
          conversations.response.status === 403,
          "Conversations aceitou origem externa.",
        );
      });

      await t.test("Rate limit por usuário retorna 429 e Retry-After", async () => {
        let hit429 = false;
        for (let attempt = 0; attempt < RATE_LIMIT + 2; attempt += 1) {
          const response = await functionRequest(status, "chat", "", {
            method: "POST",
            token: userB.token,
            body: {
              app: "nexa",
              message: `Mensagem fictícia de carga ${attempt}`,
              ...(conversationB ? { conversation_id: conversationB } : {}),
            },
          });
          if (response.response.status === 429) {
            hit429 = true;
            check(
              Number(response.response.headers.get("retry-after")) > 0,
              "429 não retornou Retry-After positivo.",
            );
            break;
          }
          check(
            response.response.status === 200,
            `Chat de carga retornou HTTP ${response.response.status}.`,
          );
          check(
            response.body?.data?.provider === "mock",
            "Carga não usou MockProvider.",
          );
          conversationB = response.body?.data?.conversation_id;
        }
        check(hit429, "Rate limit não retornou HTTP 429 dentro da janela.");
      });

      await t.test("RLS também impede User A de ler dados de User B", async () => {
        check(
          typeof conversationB === "string",
          "User B não criou conversa para o teste recíproco.",
        );
        const conversationsA = await restRows(
          status,
          "conversations",
          userA.token,
          `id=eq.${conversationB}`,
        );
        const messagesA = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${conversationB}`,
        );
        const detailA = await functionRequest(
          status,
          "conversations",
          `/${conversationB}`,
          { token: userA.token },
        );
        check(conversationsA.length === 0, "User A leu a conversa de User B.");
        check(messagesA.length === 0, "User A leu mensagens de User B.");
        check(detailA.response.status === 404, "User A obteve detalhe da conversa de User B.");
      });

      await stopServe(serve);
      serve = await startServe(status, noKeyFile);
      await t.test("Falha de provider sem chave não persiste meio turno nem vaza segredo", async () => {
        const before = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${conversationA}`,
        );
        const failure = await functionRequest(status, "chat", "", {
          method: "POST",
          token: userA.token,
          body: {
            app: "nexa",
            message: "Falha controlada local",
            conversation_id: conversationA,
          },
        });
        check(failure.response.status >= 400, "Provider sem chave foi aceito.");
        check(
          failure.body?.ok === false,
          "Erro de provider não usa envelope seguro.",
        );
        check(
          typeof failure.body?.error?.code === "string" &&
            typeof failure.body?.error?.message === "string" &&
            !JSON.stringify(failure.body).includes(status.ANON_KEY) &&
            !JSON.stringify(failure.body).includes(status.SERVICE_ROLE_KEY),
          "Erro de provider contém dados sensíveis ou formato incorreto.",
        );
        const after = await restRows(
          status,
          "messages",
          userA.token,
          `conversation_id=eq.${conversationA}`,
        );
        check(
          after.length === before.length,
          "Falha de provider deixou meio turno persistido.",
        );
      });
    } finally {
      await stopServe(serve);
      let cleanupFailures = 0;
      for (
        const [conversationId, user] of [[conversationA, userA], [
          conversationB,
          userB,
        ]]
      ) {
        if (conversationId && user) {
          try {
            const cleanup = await request(
              status,
              `/rest/v1/conversations?id=eq.${conversationId}`,
              {
                method: "DELETE",
                token: user.token,
              },
            );
            if (!cleanup.response.ok) {
              cleanupFailures += 1;
              t.diagnostic(
                "Cleanup de conversa fictícia retornou falha.",
              );
            }
          } catch {
            cleanupFailures += 1;
            t.diagnostic("Cleanup de conversa fictícia falhou.");
          }
        }
      }
      for (const id of users) {
        try {
          if (!(await deleteLocalUser(status, id))) {
            cleanupFailures += 1;
            t.diagnostic("Cleanup de usuário fictício retornou falha.");
          }
        } catch {
          cleanupFailures += 1;
          t.diagnostic("Cleanup de usuário fictício falhou.");
        }
      }
      await unlink(mockFile).catch(() => undefined);
      await unlink(noKeyFile).catch(() => undefined);
      await rmdir(tempDir).catch(() => undefined);
      check(cleanupFailures === 0, "A limpeza dos dados fictícios não foi concluída.");
    }
  },
);
