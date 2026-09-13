# Arquitetura

Esta é a arquitetura implementada da [[00 - Nexa|Nexa]], atualizada e validada localmente em 13/09/2026. O núcleo continua deliberadamente stateless e ainda não integra clientes, usuários ou dados reais.

## Fluxo implementado

```mermaid
flowchart TD
    Ascent["Ascent — cliente futuro"] --> Chat["Nexa API — Edge Function chat"]
    ERP["ERP — cliente futuro"] --> Chat
    App["Aplicativo Nexa — futuro"] --> Chat
    Chat --> HTTP["Validação HTTP e contrato Nexa"]
    HTTP --> Core["Nexa Core"]
    Core --> Context["Context Resolver"]
    Context --> Instructions["Instruction Builder"]
    Instructions --> Contract["AIProvider"]
    Contract --> Router["ProviderRouter"]
    Router -->|"primary"| Groq["GroqProvider"]
    Router -->|"um fallback técnico elegível"| Gemini["GeminiProvider"]
    Router -->|"seleção explícita / offline"| Mock["MockProvider"]
    Groq --> GroqModel["Modelo externo Groq"]
    Gemini --> GeminiModel["Gemini 3.8 Flash"]
    Health["Edge Function health"] --> Runtime["Estado seguro do serviço"]
```

As setas dos clientes representam a fronteira arquitetural futura. Ascent e ERP ainda não fazem chamadas reais. Os clientes conversam somente com a API Nexa; nenhum contrato público expõe o formato bruto de um fornecedor.

## Componentes

| Componente | Implementação e responsabilidade |
| --- | --- |
| Adaptador HTTP | `supabase/functions/chat/index.ts`: CORS, método, limite de corpo, JSON, configuração, Core e envelope HTTP. |
| Health | `supabase/functions/health/index.ts`: comprova que a camada Nexa está ativa sem depender do provider ou expor ambiente completo. |
| Nexa Core | `_shared/core/nexa-core.ts`: valida a solicitação, resolve o contexto, constrói instruções, obtém o provider injetado, chama-o e normaliza o resultado. Não importa implementações concretas de provider. |
| Context Resolver | `_shared/context/context-resolver.ts`: reconhece somente `nexa`, `ascent` e `erp` e fornece a orientação própria de cada contexto. |
| Instruction Builder | `_shared/instructions/instruction-builder.ts`: combina a identidade base da Nexa com a instrução do contexto e os limites de acesso. O conteúdo do Vault não é injetado. |
| AIProvider | `_shared/ai/provider.ts`: contrato interno definido pela Nexa, com resposta capaz de identificar provider/modelo efetivos e roteamento. |
| ProviderRouter | `_shared/ai/provider-router.ts`: chama o primary e, quando a falha é elegível, faz no máximo uma tentativa sequencial no fallback. |
| MockProvider | Provider determinístico, offline e sem chave, mantido para seleção explícita em `development`/`test` e para os testes. |
| GroqProvider | Adaptador HTTP com `fetch`, timeout, validação da resposta e erros categorizados. Não usa SDK. |
| GeminiProvider | Adaptador REST com `fetch`, modelo configurável e padrão `gemini-3.8-flash`, timeout, validação da resposta e erros categorizados. Não usa SDK. |
| Configuração | `_shared/config/config.ts`: lê ambiente, primary, fallback, allowlist CORS e opções de Groq/Gemini em um ponto central. |
| Validação e erros | Tipos, limites, request ID, envelopes e erros seguros ficam em módulos pequenos sob `_shared/`; erros de provider usam uma taxonomia comum. |

## Contrato de chat

Entrada aceita:

```ts
interface ChatRequest {
  app: "nexa" | "ascent" | "erp";
  message: string;
  conversation_id?: string;
  context?: Record<string, unknown>;
}
```

Regras atuais:

- o corpo HTTP deve ser JSON e ter no máximo 32.768 bytes;
- campos de topo desconhecidos são rejeitados;
- `message` é aparada, obrigatória e limitada a 4.000 caracteres;
- `context`, quando enviado, deve ser objeto JSON e ter no máximo 16.384 bytes;
- `conversation_id`, quando enviado, deve ter de 1 a 128 caracteres; ele é apenas validado e não produz histórico nesta fase;
- um `x-request-id` válido é preservado; na ausência ou invalidade, a Nexa gera UUID.

Sucesso:

```json
{
  "ok": true,
  "data": {
    "reply": "Nexa Mock recebeu sua mensagem no contexto ascent.",
    "app": "ascent",
    "provider": "mock",
    "model": "mock"
  },
  "request_id": "..."
}
```

Erro:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_APP",
    "message": "O aplicativo informado não é reconhecido pela Nexa."
  },
  "request_id": "..."
}
```

## Identidade e contextos

A frase base “Você é Nexa, a inteligência artificial da NexPoint” pertence ao Instruction Builder. Providers recebem instruções já construídas e não definem a identidade do produto.

- `nexa`: contexto geral interno para testes e futuro aplicativo próprio;
- `ascent`: Coach geral, limitado aos dados enviados na chamada, sem Tools ou conhecimento automático do usuário; inclui limite básico contra diagnóstico médico inventado;
- `erp`: suporte técnico básico, sem alegar acesso a banco, movimentações, logs, telas, permissões, arquivos ou Tools.

O `context` opcional é tratado como dado não confiável e permanece separado das instruções de sistema.

## Providers

O Core depende somente de `AIProvider.generate(request)`. A factory concreta monta o `ProviderRouter`, preservando o Core e os clientes sem conhecimento das implementações. A configuração local atual usa Groq como primary e Gemini como fallback. Não há chamadas simultâneas: o Router aguarda a falha do primary e faz no máximo uma chamada ao fallback.

O MockProvider retorna texto previsível e modelo `mock`. O GroqProvider usa o endpoint de chat completions da Groq, modelo configurável com padrão `openai/gpt-oss-120b`, timeout padrão de 30 segundos e `fetch` nativo injetável. O GeminiProvider usa a API REST GenerateContent, envia a chave somente no header próprio do fornecedor, adota `gemini-3.8-flash` como padrão configurável e também usa timeout padrão de 30 segundos e `fetch` injetável. Ambos preservam as mesmas instruções de identidade e contexto construídas pela Nexa.

A política de roteamento é fechada e categorizada:

| Situação do primary | Fallback |
| --- | --- |
| `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_UNAVAILABLE` ou `INVALID_PROVIDER_RESPONSE` | Elegível para uma única tentativa sequencial. |
| `AUTH_ERROR`, `CONFIG_ERROR`, `PROVIDER_REJECTED` ou `UNKNOWN_PROVIDER_ERROR` | Não elegível; o erro seguro é devolvido sem trocar de provider. |

`INVALID_PROVIDER_RESPONSE` representa uma resposta tecnicamente malformada. Recusa ou bloqueio de segurança do fornecedor é `PROVIDER_REJECTED` e não aciona fallback, evitando contornar a decisão de segurança. Se o primary estiver sem credencial em `development` ou `test`, o Router pode seguir para um fallback configurado com o motivo `PRIMARY_NOT_CONFIGURED`; em produção, a mesma ausência encerra a chamada como erro de configuração. Um fallback sem credencial nunca é usado.

A API nunca devolve corpo bruto, chave, prompt ou stack do fornecedor. A resposta pública identifica somente provider/modelo efetivos; o resultado interno também carrega metadados seguros usados nos logs de roteamento. Um eventual Consensus entre modelos permanece uma hipótese futura e não faz parte deste Router.

## Configuração, CORS e autenticação

Variáveis documentadas em `.env.example`:

```dotenv
NEXA_ENV=development
NEXA_PRIMARY_PROVIDER=groq
NEXA_FALLBACK_PROVIDER=gemini
NEXA_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TIMEOUT_MS=30000
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=30000
```

`NEXA_PRIMARY_PROVIDER` é obrigatório. `NEXA_AI_PROVIDER` permanece somente como alias legado quando a variável nova não foi informada. Valores conflitantes são rejeitados, assim como primary e fallback iguais. O Mock precisa ser selecionado explicitamente e não é aceito em produção. Segredos locais ficam no `.env` ignorado das Edge Functions e não são documentados com valores.

O código rejeita `*` na configuração e aplica uma allowlist exata. Chamadas sem `Origin` são aceitas para ferramentas locais. No teste pelo gateway local, o plugin CORS do Kong interceptou `OPTIONS` e acrescentou `Access-Control-Allow-Origin: *` às respostas; uma requisição `POST` com origem fora da allowlist ainda chegou à função e foi rejeitada com HTTP 403. A política do gateway precisa ser revisada antes de qualquer uso cloud.

`health` e `chat` usam `verify_jwt = false` porque Supabase Auth está fora deste incremento e o fluxo local precisava funcionar sem credenciais. Portanto, os endpoints são públicos no ambiente local atual; essa configuração exige revisão junto da autenticação antes de produção.

Os logs estruturados incluem apenas request ID, app validado, primary, provider efetivo, uso e motivo de fallback, duração, sucesso e código de erro. Mensagem, contexto, prompt, tokens, chaves, corpos de fornecedor e stack não são registrados.

## Estado e persistência

O fluxo é stateless. Não existem tabelas, migrations, usuários, conversas, mensagens, memória ou Tools. Consulta direta ao PostgreSQL após a implementação confirmou que `public` continua sem relações funcionais da Nexa.

## Cloud e decisões pendentes

Supabase Edge Functions foi escolhido para esta fundação local. Não houve login, link de projeto ou deploy, e a arquitetura de produção continua pendente.

- autenticação, autorização e isolamento por usuário/produto;
- persistência de conversas, histórico e memória;
- contrato de dados e integração real com [[03 - Ascent]] e [[04 - ERP]];
- eventuais Tools controladas e suas permissões;
- política CORS do gateway e segurança para produção;
- política de privacidade/redação antes de enviar dados reais a providers externos;
- rate limit, controle de abuso e limite de payload no gateway;
- operação cloud, observabilidade, custo e estratégia de deploy;
- interface própria, HUD, voz e demais itens visuais futuros.

Mudanças arquiteturais relevantes devem ser registradas em [[05 - Decisoes]]. O estado verificado está em [[06 - Estado atual]].
