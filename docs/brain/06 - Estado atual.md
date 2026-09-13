# Estado atual

**Data:** 13/09/2026

**Fase:** Fase 1 — hardening pré-cloud e Memory V1 explícita.

**Ambientes:** LOCAL concluído e validado; DEV cloud bloqueado antes de qualquer vínculo porque a Supabase CLI não está autenticada.

A Nexa local usa Supabase Auth, conversas persistentes, RLS, rate limit, histórico curto, Memory V1 e ProviderRouter. O fluxo foi validado com três usuários fictícios e MockProvider, sem chamadas externas e sem dados reais.

## Implementação atual

```text
Supabase Auth (email/senha)
  → JWT obrigatório em chat, conversations e memories
  → Conversation Service
      → ownership, app e rate limit
      → histórico recente da conversa
      → memórias globais + memórias do app atual
  → Nexa Core
      → regras estáticas de segurança
      → memória como conteúdo de usuário não confiável
  → ProviderRouter → Groq/Gemini ou Mock
  → RPC transacional → conversation + user message + assistant message
```

`health` continua público. A identidade vem do JWT validado em `/auth/v1/user`; o corpo de `chat` não aceita `user_id`. Leituras e CRUD usam JWT/chave pública e RLS. A service role permanece restrita ao commit atômico do turno `assistant`; Memory V1 não a utiliza.

Ascent e ERP continuam apenas valores de contexto. Não existe acesso às contas, bancos, permissões ou dados reais desses produtos.

## Hardening pré-cloud

### Corpo HTTP

`chat` deixou de usar `request.text()` sem limite durante a leitura. O helper compartilhado:

- rejeita antecipadamente `Content-Length` acima do teto;
- lê `Request.body` incrementalmente;
- mantém no máximo o limite permitido em memória;
- cancela o stream no primeiro chunk excedente;
- preserva `415`, `413` e `400`.

O teto é 32.768 bytes no chat e 8.192 bytes no CRUD de memória. Testes cobrem UTF-8 dividido entre chunks, limite exato, excesso sem `Content-Length`, cancelamento, JSON inválido e resposta HTTP 413.

### CORS e Kong local

Os handlers mantêm allowlist exata por `NEXA_ALLOWED_ORIGINS`, rejeitam `*` na configuração e devolvem 403 para origem não autorizada. O preflight chamado diretamente no handler retorna 204 com a origem permitida exata.

O wildcard observado no endpoint local foi classificado tecnicamente: a CLI Supabase 2.117.0 gera `functions-v1` com o plugin CORS do Kong sem configuração. No Kong 2.8.1, isso usa origem `*` e encerra `OPTIONS` antes do handler. Preflights permitidos e proibidos pelo gateway retornaram 200/wildcard e não trouxeram o `x-request-id` da função, enquanto chamadas reais proibidas chegaram ao handler e retornaram 403. Não foi feito override do Kong gerado, nem alteração no Docker Desktop. O comportamento hospedado ainda precisa ser testado no DEV; não se afirma paridade com o gateway local.

### Vector local

`supabase_vector_Nexa` continua reiniciando no Windows ao tentar acessar o Docker host. A Nexa não usa embeddings, vector search nem esse serviço nesta fase. DB, Auth, API e Edge Functions estão operacionais, portanto a falha do Vector fica aceita como limitação local. Docker TCP global não foi habilitado e nenhuma configuração global foi alterada.

## Memory V1

A migration `20260913190000_memory_v1.sql` cria `public.memories`:

| Campo | Regra |
| --- | --- |
| `id` | UUID gerado no banco. |
| `user_id` | FK para `auth.users`, default `auth.uid()`, cascade; imutável. |
| `scope` / `app` | `global` exige app nulo; `app` exige `nexa`, `ascent` ou `erp`. |
| `category` | `preference`, `fact` ou `instruction`; nunca representa permissão. |
| `source` | `user_explicit`, `app_context` ou `system`; API V1 cria somente `user_explicit` e não permite alterá-lo. |
| `content` | Aparado, não vazio e limitado a 2.000 caracteres. |
| timestamps | `created_at` imutável e `updated_at` mantido por trigger seguro. |

RLS permite SELECT, INSERT, UPDATE e DELETE somente ao proprietário. Grants por coluna impedem o cliente autenticado de informar ou alterar `user_id` e `source`. `anon` e `service_role` não receberam acesso à tabela para o fluxo de memória. O índice `(user_id, updated_at DESC, id DESC)` atende listagem e contexto recente.

### API explícita

| Rota | Resultado |
| --- | --- |
| `GET /functions/v1/memories` | Lista paginada própria: padrão 20, máximo 50, offset até 10.000. |
| `GET /functions/v1/memories/{uuid}` | Detalhe próprio. |
| `POST /functions/v1/memories` | Cria uma memória explícita; HTTP 201. |
| `PATCH /functions/v1/memories/{uuid}` | Edita campos públicos; exige conjunto não vazio. |
| `DELETE /functions/v1/memories/{uuid}` | Exclui a memória própria. |

Todas exigem Auth. Memória inexistente ou alheia retorna 404. Não existe extração automática de conversas nem decisão do LLM para guardar dados.

### Uso no chat

O chat seleciona apenas memórias globais e do app atual, em ordem `updated_at DESC, id DESC`. Envia o prefixo mais recente com no máximo 12 entradas e 6.000 caracteres. Global pode aparecer em `nexa`, `ascent` e `erp`; memórias de Ascent e ERP não cruzam entre si.

O Instruction Builder contém uma regra estática que classifica memória como dado não confiável sem autoridade. O texto dinâmico é serializado somente no conteúdo `user` enviado ao provider, nunca em `systemInstruction`. Testes usam conteúdo malicioso e confirmam essa separação. Memória não concede role, identidade, permissão ou privilégio.

## Validação LOCAL

| Verificação | Resultado |
| --- | --- |
| `npx.cmd supabase db reset` | Duas migrations aplicadas do zero no projeto local `Nexa`. |
| `npx.cmd supabase db lint --local --level warning` | Aprovado sem erro. |
| Typecheck, lint, format e testes unitários | `npm.cmd run check`: 115/115 aprovados; lint em 45 arquivos e format-check em 46. |
| Integração com Auth/RLS/chat/memory/hardening | 13/13 aprovados, usando três usuários fictícios e MockProvider. |
| Memory CRUD | User A criou, listou, editou e excluiu; source forjado foi bloqueado. |
| Isolamento | User B não leu, alterou ou excluiu memória de A pela API nem pelo Data API. |
| Escopo no chat | Ascent recebeu global + Ascent; ERP recebeu global + ERP; o limite de 12 entradas foi respeitado. |
| Memória maliciosa | Permaneceu fora da instrução de sistema e não foi ecoada pelo Mock. |
| Sem memórias | Chat manteve a resposta normal. |
| Body/CORS/rate limit | Stream acima de 32 KiB retornou 413; origens reais proibidas retornaram 403; quota retornou 429 com `Retry-After`. |
| Persistência | Conversas, mensagens, histórico e rollback em falha de provider permaneceram aprovados. |

Os testes não exigem Groq ou Gemini e não enviam tráfego a providers externos. Depois do cleanup, `auth.users`, `conversations`, `messages`, `memories` e `rate_limit_windows` foram consultadas diretamente e ficaram com zero linhas.

## Ambientes

### LOCAL

- API e Functions: `http://127.0.0.1:54421`
- DB: `127.0.0.1:54422`
- Studio: `http://127.0.0.1:54423`
- E-mail local: `http://127.0.0.1:54424`
- Dados descartáveis e separados de qualquer cloud.
- Secrets locais em `supabase/functions/.env`, ignorado pelo Git.

### DEV cloud

A Supabase CLI está instalada e o stack local responde, mas `supabase projects list` indicou ausência de autenticação da CLI. Por isso não foi possível confirmar se já existe um projeto remoto Nexa DEV, sua organização, região ou conteúdo.

Nenhum `project-ref` foi gravado, nenhum projeto foi vinculado ou criado, nenhuma migration foi aplicada remotamente, nenhum secret remoto foi configurado e nenhuma Edge Function foi publicada. Também não houve usuário cloud, teste de Auth/RLS/chat/memory, chamada real a Groq/Gemini, mudança de plano ou ativação de billing.

Depois de autenticar a CLI por um canal local seguro, é necessário:

1. listar projetos e organizações;
2. confirmar inequivocamente um projeto exclusivo Nexa DEV e a ausência de dados importantes;
3. se ele não existir, decidir organização, região, plano e senha sem reutilizar outro produto;
4. definir origens web DEV somente quando existirem domínios reais;
5. revisar `db push --dry-run`, aplicar migrations versionadas, configurar secrets e publicar apenas `health`, `chat`, `conversations` e `memories`;
6. validar JWT, RLS, CORS, rate limit, persistência e providers com dados fictícios.

## Limites restantes

- CORS do gateway hospedado não foi testado; o wildcard do Kong foi comprovado somente no stack local.
- O helper limita o buffer mantido pela aplicação, mas qualquer buffering anterior do gateway/runtime precisa ser medido no DEV.
- Não há domínio de cliente web DEV definido.
- Quando Groq ou Gemini estiver ativo, mensagem, contexto e memórias aplicáveis serão enviados ao fornecedor; política de minimização e redação para dados reais continua pendente.
- Groq e Gemini não foram chamados nesta etapa. O último teste anterior do Gemini retornou 503 e não prova disponibilidade atual.
- Vector local continua reiniciando, aceito porque não é dependência da Nexa nesta fase.
- Não há memória semântica, embeddings, vector database da Nexa, RAG complexo, auto-memory, Tools, Consensus, OpenAI/GPT, frontend, app próprio, Ascent/ERP reais, Astra, HUD, voz, agentes ou PROD.

Nenhum commit ou push foi realizado neste incremento.
