# Estado atual

**Data:** 12/09/2026  
**Fase:** Fase 1 — fundação técnica, primeiro incremento concluído.  
**Código da Nexa:** núcleo conversacional stateless implementado e validado localmente.

Este registro não marca toda a Fase 1 como concluída. Auth, usuários, persistência, integração real com produtos, cloud e segurança de produção continuam pendentes e dependem de nova autorização.

## Núcleo conversacional stateless — 12/09/2026

O fluxo funcional pedido está implementado:

```text
POST /chat
  → validação HTTP e ChatRequest
  → Nexa Core
  → Context Resolver
  → Instruction Builder
  → AIProvider
  → MockProvider ou GroqProvider
  → envelope JSON da Nexa
```

### Estrutura principal

```text
supabase/functions/
├── _shared/
│   ├── ai/              # contrato, factory, Mock e Groq
│   ├── config/          # configuração central
│   ├── context/         # contextos nexa, ascent e erp
│   ├── core/            # Nexa Core independente de HTTP/provider concreto
│   ├── errors/          # erros internos seguros
│   ├── http/            # CORS e envelopes
│   ├── instructions/    # identidade e instrução por contexto
│   ├── logging/         # log estruturado mínimo
│   ├── request/         # request ID
│   ├── types/           # contratos da Nexa
│   └── validation/      # validação estrita do ChatRequest
├── chat/index.ts
├── health/index.ts
├── tests/nexa-core.test.ts
└── deno.json
```

Arquivos auxiliares: `.env.example`, scripts de desenvolvimento em `package.json`, blocos das funções em `supabase/config.toml` e instruções locais no README.

### Comportamento implementado

- `GET /functions/v1/health` retorna somente `ok`, serviço, versão, ambiente e request ID.
- `POST /functions/v1/chat` aceita somente `nexa`, `ascent` ou `erp` e devolve envelope próprio da Nexa.
- MockProvider é o padrão, funciona offline e retorna resposta determinística.
- GroqProvider usa `fetch` nativo, endpoint fixo do fornecedor, modelo configurável, timeout e normalização segura; o Core não importa Groq.
- A identidade da Nexa e os limites de Ascent/ERP ficam fora dos providers.
- `context` é opcional, validado e tratado como dado não confiável; nenhum conteúdo do Vault é injetado.
- `conversation_id` é aceito e validado, mas não é usado para histórico ou persistência.
- Request ID aparece no header, no envelope e no log.
- Logs registram apenas request ID, app, provider, duração, sucesso e código de erro.
- CORS usa allowlist configurável e rejeita `*` na configuração da aplicação.

Contratos, limites e diagrama estão em [[02 - Arquitetura]]. Decisões técnicas estão em [[05 - Decisoes#12/09/2026 — primeiro núcleo técnico da Fase 1]].

## Validações executadas

`npm.cmd run check` terminou com código 0:

| Verificação | Resultado |
| --- | --- |
| Deno `check` 2.1.4 | Três entrypoints verificados: `health`, `chat` e testes. |
| Deno lint | 18 arquivos aprovados. |
| Deno fmt check | 19 arquivos aprovados. |
| Testes Node | 20/20 aprovados, zero falhas, sem rede externa. |

Os testes cobrem os três contextos, app inválido, mensagem vazia/grande, contexto inválido, provider inexistente, falha simulada, normalização, seleção de instrução, request ID, política CORS, media type e GroqProvider simulado para chave ausente, sucesso, HTTP não 2xx, resposta inválida, timeout e falha de rede.

### Chamadas reais no Edge Runtime local

As funções foram servidas com Supabase Edge Runtime 1.74.3, compatível com Deno 2.1.4. O primeiro ciclo usou `supabase functions serve --env-file .env.example`; depois o stack foi parado e iniciado de forma restrita ao projeto Nexa para restaurar o runtime persistente. As chamadas foram repetidas após a restauração.

| Chamada | Resultado validado |
| --- | --- |
| `GET health` | HTTP 200, versão `0.1.0-dev`, ambiente `development`. |
| `POST chat`, `app=nexa` | HTTP 200, provider/modelo `mock`, resposta determinística no contexto `nexa`. |
| `POST chat`, `app=ascent` | HTTP 200, resposta determinística no contexto `ascent`. |
| `POST chat`, `app=erp` | HTTP 200, resposta determinística no contexto `erp`. |
| `POST chat`, app desconhecido | HTTP 400, `INVALID_APP`, envelope seguro e request ID. |
| `POST chat`, origem permitida | HTTP 200. |
| `POST chat`, origem não permitida | HTTP 403, `ORIGIN_NOT_ALLOWED`. |

IDs válidos enviados nos testes foram preservados. Os logs observados continham somente metadados operacionais; mensagem, contexto, prompt e segredo não apareceram.

O plugin CORS do Kong local interceptou `OPTIONS` e acrescentou `Access-Control-Allow-Origin: *` às respostas do gateway, inclusive quando o handler define uma origem exata. A função ainda recusou o `POST` de origem não autorizada. Essa política do gateway é uma limitação local verificada e precisa ser revista antes de qualquer uso cloud.

## Groq

**GroqProvider implementado; teste externo não executado por ausência de credencial.** A ausência de `GROQ_API_KEY` não afeta health nem o MockProvider. Nenhuma chave foi solicitada, criada ou impressa. O comportamento do provider foi validado apenas com `fetch` injetado nos testes, sem consumo da API externa.

## Supabase Local

**Situação:** operacional nos serviços necessários, com a limitação conhecida do Vector no Windows.

- Supabase CLI 2.117.0 instalada localmente e executada via `npx.cmd`/scripts npm.
- Edge Functions `health` e `chat` habilitadas em `supabase/config.toml`, ambas com `verify_jwt = false` porque Auth está fora deste incremento.
- `npm.cmd run supabase:stop`, `supabase:start` e `supabase:status` terminaram com código 0; o stop usou o filtro de projeto `Nexa` e preservou volumes.
- O stack não está ligado a projeto cloud (`linked_project: null`).

| Serviço | Porta / endereço local | Situação final |
| --- | --- | --- |
| API / Functions | `http://127.0.0.1:54421` | Ativa; health e chat respondendo. |
| DB | `postgresql://postgres:postgres@127.0.0.1:54422/postgres` | Ativo e saudável. |
| Studio | `http://127.0.0.1:54423` | Ativo e saudável. |
| E-mail local | `http://127.0.0.1:54424` | Ativo e saudável. |
| Analytics | `http://127.0.0.1:54427` | Ativo e saudável. |
| Shadow DB | `54420` | Configurada, sem publicação no stack normal. |
| SMTP / POP3 | `54425` / `54426` | Reservadas em exemplos comentados. |
| Vector | `54428` reservada | Container reiniciando pela limitação conhecida. |
| Pooler | `54429` | Configurado, mas desabilitado. |

### Vector e Explorer

`supabase_vector_Nexa` continua reiniciando porque a CLI tenta acessar `host.docker.internal:2375`. A configuração global do Docker não foi alterada, conforme a restrição do projeto. Os serviços necessários e Analytics continuam operacionais.

A extensão XTECH Supabase 0.0.4 anteriormente inspecionada encontra o `config.toml`, mas tenta executar `supabase status` sem `npx`; o Extension Host do VS Code precisa herdar o caminho do binário local para exibir o stack. Nenhum PATH global ou configuração da extensão foi alterado.

## Banco

Nenhuma migration, seed ou tabela da Nexa foi criada. Consulta direta a `pg_class` após o reinício retornou `[]` para tabelas, tabelas particionadas, views, materialized views, sequences e foreign tables no schema `public`.

Não existem `conversations`, `messages`, `memory`, `users`, `tools`, `ascent_*` ou `erp_*`. O fluxo não grava dados.

## Dependências e segredos

- Nenhuma dependência foi adicionada. `supabase` foi preservado como `devDependency` existente.
- Deno 2.1.4 foi executado por `npx --yes` para ferramentas de qualidade, sem ser incluído no manifesto.
- Nenhum framework web ou SDK de IA foi instalado.
- `.env` e `.env.*` continuam ignorados; somente `.env.example`, com chave vazia, é liberado para versionamento.
- A inspeção de segredos não encontrou credencial real nos arquivos criados.

## Limites atuais

- Os endpoints usam `verify_jwt = false` e são públicos localmente. Auth e autorização precisam ser projetados antes de produção.
- CORS protege o uso em navegadores, mas não substitui Auth, rate limit ou controle de abuso; o gateway local publica a API na interface Docker configurada.
- Não há usuário, separação por identidade, conversa, histórico ou memória persistente.
- Ascent e ERP são somente contextos de instrução; não existe integração ou dado real.
- Quando Groq for habilitado, mensagem e `context` serão enviados ao provider externo; privacidade e redação precisam ser definidas antes de usar dados reais.
- Sem `Content-Length`, o adaptador precisa carregar o corpo antes de verificar os 32 KiB. Antes de exposição externa, convém impor o limite também no gateway ou usar leitura limitada por stream.
- Não existem Tools, ações em produtos, frontend, HUD, partículas, WebGL, voz, escuta, agentes, controle do computador, Codex ou Jarvis.
- Nenhum login, link, deploy ou recurso cloud foi realizado.

## Git e preservação

O repositório permanece na branch `main`, sem commit, push ou arquivos preparados no índice. A maior parte do projeto continua não rastreada porque o repositório tinha apenas `.gitattributes` no commit inicial; isso foi preservado e deve ser revisto antes de um futuro commit autorizado.

O Vault de desenvolvimento permanece em `docs/brain/`; ele não é memória da IA. A nota tutorial e configurações úteis do Obsidian foram preservadas. O registro global antigo do Obsidian não foi alterado.

## Próximos passos recomendados

Somente após nova autorização:

1. definir Auth, autorização, isolamento por usuário/produto, rate limit e política CORS do gateway;
2. projetar migrations e persistência de conversas/histórico em uma fase separada;
3. decidir como o contexto autorizado será obtido, minimizado e redigido antes do envio a providers;
4. integrar Ascent e ERP em incrementos próprios, sem acesso irrestrito;
5. preparar ambiente cloud, observabilidade e deploy somente depois da revisão de segurança;
6. deixar HUD e recursos visuais para a fase visual já documentada.

Este incremento termina neste relatório. Não iniciar autenticação, persistência ou integração real automaticamente.
