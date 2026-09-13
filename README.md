# Nexa

A Nexa é a inteligência artificial da NexPoint. O backend local usa Supabase Auth, Edge Functions, conversas persistentes com RLS e ProviderRouter (Groq principal, Gemini fallback técnico ou Mock explícito para testes offline).

## Rodar e testar localmente

Pré-requisitos: Docker Desktop, Node.js/npm e dependências instaladas com `npm.cmd install`. Execute na raiz deste repositório:

```powershell
npm.cmd run supabase:start
npm.cmd run check
```

Após alterar migrations, `npx.cmd supabase db reset` reaplica o banco **local da Nexa** e apaga os dados locais existentes; confira `npx.cmd supabase status` antes de executá-lo. O teste de integração cria e remove usuários fictícios, usa Mock e exige o stack local ativo:

```powershell
$env:NEXA_RUN_LOCAL_INTEGRATION = "1"
npm.cmd run test:integration:local
Remove-Item Env:NEXA_RUN_LOCAL_INTEGRATION
```

Para desenvolvimento com recarga das Edge Functions, use `npm.cmd run functions:serve`. O Supabase carrega o arquivo local ignorado `supabase/functions/.env`; `.env.example` documenta somente nomes e valores não secretos. `NEXA_RATE_LIMIT_PER_MINUTE` controla a quota por usuário (padrão 6 por janela fixa de 60 segundos). Para trabalhar offline, configure `NEXA_PRIMARY_PROVIDER=mock` sem fallback no `.env`. Nunca versione chaves, JWTs ou senhas.

O stack local usa:

- `GET http://127.0.0.1:54421/functions/v1/health` — público;
- `POST http://127.0.0.1:54421/functions/v1/chat` — Bearer JWT obrigatório; cria conversa se `conversation_id` não for enviado;
- `GET http://127.0.0.1:54421/functions/v1/conversations` — lista as próprias conversas (`limit` 1–50, padrão 20; `offset` 0–10.000);
- `GET http://127.0.0.1:54421/functions/v1/conversations/{uuid}` — detalhe e mensagens (`limit` 1–100, padrão 50);
- `DELETE http://127.0.0.1:54421/functions/v1/conversations/{uuid}` — exclui a conversa e suas mensagens.

Para uma chamada manual, crie uma conta fictícia no Supabase Auth local (Studio: `http://127.0.0.1:54423`), faça login via Auth e envie o access token em `Authorization: Bearer <JWT>` com a chave pública local em `apikey`. O contrato de chat é `{"app":"nexa","message":"Olá","conversation_id":"UUID opcional"}`; a resposta inclui `conversation_id`. Conta de outro usuário não acessa essa conversa. Ascent e ERP ainda são apenas contextos de instrução, sem integração com dados reais.

## Documentação

- [Visão do produto](<docs/brain/00 - Nexa.md>)
- [MVP e ordem das fases](<docs/brain/01 - MVP atual.md>)
- [Arquitetura](<docs/brain/02 - Arquitetura.md>)
- [Decisões](<docs/brain/05 - Decisoes.md>)
- [Estado atual e verificações](<docs/brain/06 - Estado atual.md>)
- [Instruções para agentes](AGENTS.md)

O Vault em `docs/brain/` documenta o desenvolvimento; não é memória de usuários da Nexa.
