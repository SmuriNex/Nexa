# Nexa

A Nexa é a inteligência artificial da NexPoint. O backend usa Supabase Auth, Edge Functions, conversas persistentes, Memory V1 explícita com RLS e ProviderRouter (Groq principal, Gemini fallback técnico ou Mock explícito para testes offline).

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
- `GET|POST http://127.0.0.1:54421/functions/v1/memories` — lista ou cria memórias explícitas do usuário;
- `GET|PATCH|DELETE http://127.0.0.1:54421/functions/v1/memories/{uuid}` — consulta, edita ou exclui memória própria.

Para uma chamada manual, crie uma conta fictícia no Supabase Auth local (Studio: `http://127.0.0.1:54423`), faça login via Auth e envie o access token em `Authorization: Bearer <JWT>` com a chave pública local em `apikey`. O contrato de chat é `{"app":"nexa","message":"Olá","conversation_id":"UUID opcional"}`; a resposta inclui `conversation_id`. Memórias são criadas de forma explícita, podem ser `global` ou de um app e nunca concedem permissões. Conta de outro usuário não acessa conversas nem memórias. Ascent e ERP ainda são apenas contextos de instrução, sem integração com dados reais.

## Ambiente DEV cloud

O DEV deve ser um projeto Supabase exclusivo da Nexa, separado do banco local, marcado com `NEXA_ENV=development` e preenchido somente com dados fictícios. **O projeto ainda não foi identificado, vinculado ou publicado:** a CLI desta máquina não está autenticada. Não execute os comandos abaixo até confirmar projeto, organização e ausência de dados importantes.

Fluxo preparado para quando a CLI estiver autenticada e o projeto correto confirmado:

```powershell
npx.cmd supabase login
npx.cmd supabase projects list
npx.cmd supabase link --project-ref <NEXA_DEV_PROJECT_REF>
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
npx.cmd supabase secrets set --env-file <ARQUIVO_DEV_SEGURO_FORA_DO_GIT>
npx.cmd supabase functions deploy health
npx.cmd supabase functions deploy chat
npx.cmd supabase functions deploy conversations
npx.cmd supabase functions deploy memories
```

O arquivo seguro de DEV deve configurar somente os nomes necessários, como `NEXA_ENV`, providers/modelos, rate limit e origens permitidas, além de `GROQ_API_KEY` e `GEMINI_API_KEY`. Nunca registre valores no repositório. Se ainda não houver domínio web DEV, não invente uma origem; mantenha a validação por navegador pendente. Nunca use `db reset` no projeto remoto e nunca vincule este repositório a projetos do Ascent, ERP ou caixa.

## Documentação

- [Visão do produto](<docs/brain/00 - Nexa.md>)
- [MVP e ordem das fases](<docs/brain/01 - MVP atual.md>)
- [Arquitetura](<docs/brain/02 - Arquitetura.md>)
- [Decisões](<docs/brain/05 - Decisoes.md>)
- [Estado atual e verificações](<docs/brain/06 - Estado atual.md>)
- [Instruções para agentes](AGENTS.md)

O Vault em `docs/brain/` documenta o desenvolvimento; não é memória de usuários da Nexa.
