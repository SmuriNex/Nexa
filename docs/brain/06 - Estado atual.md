# Estado atual

**Data:** 13/09/2026
**Fase:** Fase 1 — Auth, autorização, segurança básica e conversas persistentes no Supabase Local.

O código desta etapa implementa Supabase Auth com JWT obrigatório em `chat` e `conversations`, RLS e conversas persistentes. O fluxo local foi validado com dois usuários fictícios, incluindo isolamento cruzado e rate limit.

## Implementação

```text
Supabase Auth (email/senha)
  → JWT no POST /functions/v1/chat
  → validação do usuário em /auth/v1/user
  → Conversation Service: ownership, app e rate limit
  → histórico recente → Nexa Core → ProviderRouter → Groq/Gemini ou Mock
  → RPC transacional → conversation + user message + assistant message
```

`health` continua público. `chat` e `conversations` exigem Bearer JWT, com `verify_jwt = true` no gateway e validação adicional dentro da função. Consultas, exclusão e rate limit usam o token do usuário e RLS. Somente o commit atômico do turno usa a service role server-side para criar `assistant`; a RPC revalida papel, usuário, owner e app. O `chat` não aceita identidade no request body. O `context` continua dado não confiável e não concede permissão.

Os contextos `nexa`, `ascent` e `erp` seguem reconhecidos. Qualquer usuário autenticado **local** pode testá-los nesta etapa; não há autorização vinculada a contas reais de Ascent ou ERP, nem leitura de dados desses produtos.

### Contrato e consistência

- `POST /functions/v1/chat` recebe `app`, `message`, `conversation_id` UUID opcional e `context` opcional. Sem ID, cria uma conversa ao concluir o turno. Com ID, a conversa deve pertencer ao usuário e manter o mesmo app.
- Sucesso acrescenta `data.conversation_id` ao envelope existente com `reply`, `app`, `provider`, `model` e `request_id`.
- A RPC `nexa_append_turn` grava conversa nova e par de mensagens user/assistant em uma transação **após** resposta do provider. Falha do provider não grava mensagem órfã nem conversa nova vazia. A tentativa consome quota.
- Histórico entregue ao Core: últimas 8 mensagens, até 12.000 caracteres ao remover as mais antigas. Groq e Gemini recebem esse histórico normalizado; não há memória longa ou resumo.
- App divergente em conversa própria gera 409. Conversa inexistente ou de outro usuário gera 404.
- Título inicial deriva dos primeiros até 80 caracteres da primeira mensagem, sem chamada adicional de IA.

### API de conversas

| Rota | Resposta mínima | Limites |
| --- | --- | --- |
| `GET /functions/v1/conversations` | `data.conversations` com ID, app, título e timestamps; `data.pagination`. | `limit` padrão 20, 1–50; `offset` padrão 0, 0–10.000. |
| `GET /functions/v1/conversations/{uuid}` | `data.conversation`, `data.messages` e `data.pagination`. | `limit` padrão 50, 1–100; mesmo `offset`. |
| `DELETE /functions/v1/conversations/{uuid}` | `data.conversation_id`, `data.deleted: true`. | Remove mensagens por cascade. |

Não há Edge Function de criação separada: o primeiro chat cria a conversa. Listagens não carregam todas as mensagens. O Data API continua disponível apenas para as operações por coluna concedidas na migration, sempre sob RLS; nele, qualquer `user_id` recebido é conferido contra `auth.uid()`.

### Banco e políticas

A migration versionada `supabase/migrations/20260913170000_auth_conversations.sql` cria:

| Tabela | Proteção |
| --- | --- |
| `public.conversations` | RLS com SELECT/INSERT/UPDATE de título/DELETE somente da própria linha. FK para `auth.users`; app e owner imutáveis. |
| `public.messages` | RLS: SELECT apenas de mensagens em conversa própria e INSERT direto somente de role `user` nela. `assistant` só pela RPC server-side, sem EXECUTE para `authenticated`. FK com `ON DELETE CASCADE`. |
| `public.rate_limit_windows` | RLS ativa sem grants ou policies diretas para clientes; consumo por RPC autenticada e atômica. |

Funções privilegiadas ficam em `nexa_private`, fora do schema exposto, com `search_path` vazio. O rate limit deriva o usuário de `auth.uid()` e é concedido a `authenticated`. `nexa_append_turn` é concedida somente a `service_role`, recebe o ID confirmado pelo Auth e revalida papel server-side, owner e app. Não foi necessária tabela `profiles`. O schema não inclui memória, embeddings, dados de Ascent/ERP ou Tools.

### Limites e privacidade

`NEXA_RATE_LIMIT_PER_MINUTE` define a quota por usuário em janela fixa de 60 segundos. O padrão local é 6 tentativas; a configuração aceita 1–100. Excesso retorna 429 e `Retry-After`. O UPSERT não permite que uma chamada atrasada mova a janela para trás. Continuam os limites de 32.768 bytes por corpo, 4.000 caracteres por mensagem, 16.384 bytes para `context`, validação estrita de campos e allowlist CORS. Logs distinguem os estágios `provider` e `request` e não devem conter email, mensagem, histórico, JWT, contexto, prompt, chaves ou corpos brutos dos providers.

O Kong local acrescentou `Access-Control-Allow-Origin: *` ao preflight, embora as funções tenham recusado `POST` e `GET` de origem não autorizada com 403 nos testes. A política do gateway exige revisão antes de cloud. CORS não substitui Auth nem RLS.

## Validação

Antes desta etapa, `npm.cmd run check` aprovou 69/69 testes do núcleo stateless e ProviderRouter. Groq respondeu em chamadas reais; Gemini chegou ao fornecedor, mas devolveu HTTP 503 nas tentativas controladas. Esses resultados **não** validam Auth, RLS ou persistência.

| Verificação desta etapa | Resultado verificado |
| --- | --- |
| `npx.cmd supabase db reset` no stack local da Nexa | Migration final aplicada do zero; três tabelas com RLS ativa e seis policies. Tabelas vazias antes dos testes. |
| Typecheck, lint, format e testes unitários | `npm.cmd run check` aprovado: typecheck, lint e format check sem erros; `npm test`: 96/96 aprovados. |
| Integração local com login de usuários fictícios A e B | 10/10 testes opt-in aprovados, sem chamadas reais a Groq/Gemini. |
| RLS cruzada: B não lê, altera, exclui ou insere em conversa A | Bloqueio confirmado; A mantém acesso aos próprios dados e também não lê conversa/mensagens de B. Chamada direta de `nexa_append_turn` por usuário autenticado foi rejeitada. |
| Chat, segunda mensagem, histórico, app imutável e erro de provider | Duas mensagens de A geraram quatro registros user/assistant na mesma conversa; histórico usado. Falha controlada do provider não deixou registros parciais nem vazou segredo. |
| 429 com `Retry-After`, health público e CORS | Rate limit por usuário e header confirmados; health público; POST/GET de origem proibida retornaram 403. Preflight do Kong ainda apresentou wildcard. |

Depois do teste, a limpeza deixou `auth.users`, `conversations`, `messages` e `rate_limit_windows` com zero linhas.

O teste de integração local opt-in fica em `tests/integration/local-integration.test.mjs` e cria contas fictícias temporárias. Ele deve ser executado somente com o Supabase Local da Nexa ativo e após `db reset`. Não usa Groq/Gemini reais para validar Auth e persistência.

## Ambiente local e segredos

O stack local usa API/Functions em `http://127.0.0.1:54421`, DB em `127.0.0.1:54422`, Studio em `http://127.0.0.1:54423` e e-mail local em `http://127.0.0.1:54424`. `health` usa `verify_jwt = false`; `chat` e `conversations` usam `verify_jwt = true`. A CLI está instalada como dependência de desenvolvimento; não houve link nem deploy cloud.

### Supabase Local — 12/09/2026

A faixa reservada permanece 54420–54429: shadow DB 54420, API 54421, DB 54422, Studio 54423, e-mail 54424, Analytics 54427 e pooler 54429 desabilitado. SMTP/POP3 em 54425/54426 continuam apenas comentados e 54428 não é publicada. O container `supabase_vector_Nexa` continua reiniciando no Windows ao tentar acessar `host.docker.internal:2375`; os serviços necessários desta etapa estão operacionais. A extensão XTECH Supabase 0.0.4 observada na configuração anterior procura `supabase` diretamente, enquanto este projeto usa a CLI local via `npx.cmd`; nenhum PATH global ou configuração da extensão foi alterado.

As credenciais locais de provider permanecem em `supabase/functions/.env`, ignorado pelo Git. `.env.example` documenta apenas nomes e configurações sem valores reais. A implementação de Auth usa a chave pública e o JWT para operações sob RLS. A service role injetada pelo runtime é usada somente no commit server-side, nunca enviada ao cliente ou persistida; senha e token de usuário também não são armazenados na base da Nexa.

## Limites restantes

- Autorização real de usuários para Ascent/ERP e acesso minimizado aos dados desses produtos dependem das integrações futuras.
- Quando Groq ou Gemini está ativo, `message` e `context` são enviados ao provider escolhido; a política de privacidade/redação de dados reais ainda precisa ser definida.
- Sem `Content-Length`, a função carrega o corpo antes de medir 32 KiB; o gateway futuro também deve impor esse limite.
- CORS do gateway, observabilidade/custos e operação cloud ainda não foram projetados para produção.
- O container Vector local continua reiniciando no Windows por tentar alcançar `host.docker.internal:2375`; API, Auth, DB, Functions e Analytics permanecem operacionais.
- Gemini respondeu HTTP 503 na validação anterior; uma resposta real bem-sucedida ainda não foi comprovada nesta etapa.
- Não há memória longa, embeddings, RAG, Consensus, Tools, frontend, app próprio, Astra, HUD, voz ou agentes.

Não houve commit, push, link ou deploy nesta etapa. O estado final do Git deve ser conferido após todas as alterações.
