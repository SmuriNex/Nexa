# Estado atual

**Data:** 13/09/2026

**Fase:** Fase 1 — fundação técnica, roteamento Groq/Gemini implementado.

**Código da Nexa:** núcleo conversacional stateless com ProviderRouter implementado e validado localmente.

Este registro não marca toda a Fase 1 como concluída. Auth, usuários, persistência, integração real com produtos, cloud e segurança de produção continuam pendentes e dependem de nova autorização.

## Núcleo conversacional stateless — atualizado em 13/09/2026

O fluxo funcional pedido está implementado:

```text
POST /chat
  → validação HTTP e ChatRequest
  → Nexa Core
  → Context Resolver
  → Instruction Builder
  → AIProvider
  → ProviderRouter
      → primary GroqProvider
      → fallback GeminiProvider em falha técnica elegível
      → MockProvider para seleção explícita/offline
  → envelope JSON da Nexa
```

### Estrutura principal

```text
supabase/functions/
├── _shared/
│   ├── ai/              # contrato, factory, Router, Mock, Groq e Gemini
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
├── tests/               # Core, Groq/Gemini e roteamento
└── deno.json
```

Arquivos auxiliares: `.env.example`, scripts de desenvolvimento em `package.json`, blocos das funções em `supabase/config.toml` e instruções locais no README.

### Comportamento implementado

- `GET /functions/v1/health` retorna somente `ok`, serviço, versão, ambiente e request ID.
- `POST /functions/v1/chat` aceita somente `nexa`, `ascent` ou `erp` e devolve envelope próprio da Nexa.
- ProviderRouter executa o primary e faz no máximo uma tentativa sequencial no fallback quando a falha é tecnicamente elegível; não há consultas simultâneas.
- A configuração local usa Groq como primary e Gemini como fallback.
- MockProvider funciona offline, retorna resposta determinística e permanece disponível por seleção explícita em `development`/`test` e nos testes; não existe fallback silencioso para Mock.
- GroqProvider e GeminiProvider usam `fetch` nativo, endpoints fixos, modelos configuráveis, timeout, respostas normalizadas e erros categorizados; o Core não importa os providers concretos.
- GeminiProvider usa a API REST GenerateContent e o modelo padrão configurável `gemini-3.8-flash`.
- Fallback é elegível somente para rate limit, timeout, rede, indisponibilidade e resposta tecnicamente inválida. Erros de autenticação/configuração, recusa do provider e erros desconhecidos encerram a chamada sem fallback.
- Em `development`/`test`, primary sem credencial pode seguir para um fallback configurado; em produção, essa ausência é erro de configuração.
- A identidade da Nexa e os limites de Ascent/ERP ficam fora dos providers.
- `context` é opcional, validado e tratado como dado não confiável; nenhum conteúdo do Vault é injetado.
- `conversation_id` é aceito e validado, mas não é usado para histórico ou persistência.
- Request ID aparece no header, no envelope e no log.
- Respostas e logs identificam provider/modelo efetivos e, nos logs, primary, uso e motivo seguro do fallback; conteúdo, prompt, corpos externos e segredos não são registrados.
- CORS usa allowlist configurável e rejeita `*` na configuração da aplicação.

Contratos, limites e diagrama estão em [[02 - Arquitetura]]. As decisões do Router estão em [[05 - Decisoes#13/09/2026 — roteamento Groq/Gemini da Fase 1]].

## Validações executadas

`npm.cmd run check` terminou com código 0:

| Verificação | Resultado |
| --- | --- |
| Deno `check` 2.1.4 | Entrypoints e três arquivos de testes verificados. |
| Deno lint | 24 arquivos aprovados. |
| Deno fmt check | 25 arquivos aprovados. |
| Testes Node | 69/69 aprovados, zero falhas, sem chamadas externas. |

Os testes cobrem os contratos e contextos existentes, validação antes da factory, request ID, CORS e envelopes seguros; GroqProvider e GeminiProvider com sucesso e categorias de falha; e ProviderRouter com primary bem-sucedido, fallback elegível, erros não elegíveis, credencial ausente por ambiente, Mock offline, falha dos dois providers e garantia de uma única tentativa sequencial.

### Chamadas reais no Edge Runtime local

As funções foram servidas localmente com as credenciais no arquivo ignorado próprio das Edge Functions. As validações abaixo registram somente status, provider/modelo e latência; nenhuma resposta textual, corpo de erro ou credencial foi incluída neste documento.

| Chamada | Resultado validado |
| --- | --- |
| Groq, `app=nexa` | HTTP 200 em 1.014 ms; provider `groq`, modelo `openai/gpt-oss-120b`. |
| Groq, `app=ascent` | HTTP 200 em 969 ms; provider `groq`, modelo `openai/gpt-oss-120b`. |
| Gemini, `app=nexa` | Upstream HTTP 503 após 4.722 ms. |
| Gemini, `app=erp` | Upstream HTTP 503 após 2.026 ms. |
| Gemini, repetição controlada de `app=nexa` | Upstream HTTP 503 após 3.415 ms; sem resposta utilizável. |
| Fallback controlado | O primary Groq simulado foi chamado exatamente uma vez; o Router acionou Gemini e encerrou com upstream HTTP 503 após 5.938 ms. Não houve repetição nem loop. |

O Groq concluiu as chamadas dos dois contextos testados. As tentativas Gemini chegaram ao fornecedor, mas não produziram resposta utilizável devido ao HTTP 503, compatível com indisponibilidade externa transitória. Por isso, a integração e a classificação segura desse erro foram exercitadas, mas uma resposta real bem-sucedida do Gemini permanece pendente de nova disponibilidade do serviço.

O plugin CORS do Kong local interceptou `OPTIONS` e acrescentou `Access-Control-Allow-Origin: *` às respostas do gateway, inclusive quando o handler define uma origem exata. A função ainda recusou o `POST` de origem não autorizada. Essa política do gateway é uma limitação local verificada e precisa ser revista antes de qualquer uso cloud.

## Roteamento e providers

**GroqProvider validado com respostas reais; GeminiProvider implementado e alcançou o serviço, que respondeu HTTP 503 nas tentativas controladas.** O 503 é tratado como indisponibilidade técnica elegível para fallback quando ocorre no primary. A validação controlada provou que o Router chama o primary uma vez e o fallback uma vez; como o Gemini também estava indisponível, o Router devolveu erro seguro e encerrou.

`RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_UNAVAILABLE` e `INVALID_PROVIDER_RESPONSE` são elegíveis. `AUTH_ERROR`, `CONFIG_ERROR`, `PROVIDER_REJECTED` e `UNKNOWN_PROVIDER_ERROR` não são elegíveis. Consensus entre providers não foi implementado e nenhuma chamada paralela é feita.

## Supabase Local

**Situação:** operacional nos serviços necessários, com a limitação conhecida do Vector no Windows.

- Supabase CLI 2.117.0 instalada localmente e executada via `npx.cmd`/scripts npm.
- Edge Functions `health` e `chat` habilitadas em `supabase/config.toml`, ambas com `verify_jwt = false` porque Auth está fora deste incremento.
- `npm.cmd run supabase:stop`, `supabase:start` e `supabase:status` terminaram com código 0; o stop usou o filtro de projeto `Nexa` e preservou volumes.
- O stack não está ligado a projeto cloud (`linked_project: null`).

| Serviço | Porta / endereço local | Situação final |
| --- | --- | --- |
| API / Functions | `http://127.0.0.1:54421` | Ativa; health e chat respondendo. |
| DB | `127.0.0.1:54422` | Ativo e saudável. |
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
- Nenhum framework web ou SDK de IA foi instalado; ambos os providers usam `fetch` nativo.
- `.env` e `.env.*` continuam ignorados; somente `.env.example`, com chave vazia, é liberado para versionamento.
- As credenciais locais dos providers permanecem no `.env` ignorado das Edge Functions; nenhum valor foi registrado nesta documentação.

## Limites atuais

- Os endpoints usam `verify_jwt = false` e são públicos localmente. Auth e autorização precisam ser projetados antes de produção.
- CORS protege o uso em navegadores, mas não substitui Auth, rate limit ou controle de abuso; o gateway local publica a API na interface Docker configurada.
- Não há usuário, separação por identidade, conversa, histórico ou memória persistente.
- Ascent e ERP são somente contextos de instrução; não existe integração ou dado real.
- Quando Groq ou Gemini é habilitado, mensagem e `context` são enviados ao provider externo escolhido; privacidade e redação precisam ser definidas antes de usar dados reais.
- O Gemini respondeu HTTP 503 nas tentativas reais desta validação. Esse resultado é compatível com indisponibilidade externa transitória e ainda falta comprovar uma resposta Gemini bem-sucedida quando o serviço estiver disponível.
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
6. avaliar Consensus somente em fase futura própria, caso seja autorizado e tenha política de custo, latência e segurança definida;
7. deixar HUD e recursos visuais para a fase visual já documentada.

Este incremento termina neste relatório. Não iniciar autenticação, persistência ou integração real automaticamente.
