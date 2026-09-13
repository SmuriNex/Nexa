# Decisões

## 12/09/2026 — definições iniciais

**Origem:** orientação do responsável pelo projeto fornecida nesta tarefa, “Você está assumindo o desenvolvimento do projeto NEXA, da NexPoint”. As decisões abaixo foram consolidadas dessa orientação; não são escolhas técnicas feitas pelo agente.

| ID | Decisão |
| --- | --- |
| D01 | A Nexa é a inteligência artificial da NexPoint. |
| D02 | O nome correto do aplicativo é **Ascent**. Não usar “Ascend” ou “Acend”. |
| D03 | A Nexa não será um LLM treinado do zero no MVP. |
| D04 | Modelos externos serão utilizados através de uma abstração de AI Provider. |
| D05 | A identidade da Nexa deve ser independente do fornecedor de IA. |
| D06 | As primeiras integrações serão Ascent, como Coach, e ERP, como suporte técnico básico. |
| D07 | Jarvis, Codex, controle de computador, voz, agentes e automações pertencem à visão futura, fora do MVP atual. |
| D08 | Desenvolvimento funcional-first: **funcionalidade primeiro, visual avançado depois**. |
| D09 | Usuários comuns ficam limitados ao contexto autorizado do aplicativo em uso, com separação por usuário e produto. |
| D10 | Não haverá acesso irrestrito aos bancos. Alterações futuras deverão usar Tools/APIs controladas e validadas; os detalhes não estão definidos. |
| D11 | A intenção atual é execução em nuvem; o PC será usado principalmente para desenvolvimento. Infraestrutura ainda pendente; Supabase é apenas uma possibilidade. |
| D12 | O brain do Obsidian é documentação do desenvolvimento e não a futura memória dos usuários da Nexa. |
| D13 | A direção visual do aplicativo próprio deve ser preservada em documentação nesta fase, sem implementação. |
| D14 | A etapa inicial de organização documental autorizou exclusivamente inspeção, organização, consolidação e documentação, sem início automático da fase seguinte. |

Em D08, vêm primeiro Nexa funcional, cloud, conversação, Ascent e ERP. Aplicativo próprio, HUD avançado, cérebro de partículas, voz, escuta e polimento visual ficam para depois. A ordem completa das fases está em [[01 - MVP atual#Ordem oficial de desenvolvimento]], e a intenção visual em [[00 - Nexa#Direção visual do aplicativo próprio]].

## 12/09/2026 — preservação e organização do Vault

**Origem:** inspeção dos arquivos locais antes da reorganização.

- O Vault original era `cerebo Nexa/`, dentro da raiz Git `D:\NexStudio\Nexa\Nexa`.
- A única nota anterior era `Bem-vindo.md`, tutorial padrão do Obsidian, sem decisões de produto ou arquitetura. Ela foi preservada integralmente, com seus links, e movida junto do Vault para `docs/brain/`.
- A nota já continha o exemplo de wikilink sem destino `crie um link` e um link externo para o Importer. Não foi criada uma nota artificial para resolver o exemplo, nem foi apagado o tutorial.
- Os cinco JSONs de `.obsidian` foram preservados integralmente: `app.json`, `appearance.json`, `core-plugins.json`, `graph.json` e `workspace.json`.
- `core-plugins.json` conserva recursos como backlinks, links de saída, grafo e templates. Não havia plugins comunitários, temas ou templates próprios; `app.json` e `appearance.json` estavam vazios (`{}`).
- Decisão de organização: manter `.obsidian` elegível ao versionamento para preservar a configuração encontrada. Ignorar somente `workspace*.json`, que representa layout, abas e estado pessoal; o arquivo existente continua no disco. As preferências do grafo também foram mantidas por preservação.
- O registro global do Obsidian apontava para um caminho anterior inexistente, `D:\NexStudio\Nexa\cerebo Nexa`. Esse registro não foi alterado; o README orienta abrir `docs/brain` como cofre existente.

## 12/09/2026 — portas do Supabase Local

**Origem:** pedido posterior do responsável para finalizar exclusivamente o Supabase Local da Nexa, com a CLI já instalada e `supabase init` já executado. Essa autorização pontual permite configurar e validar a infraestrutura local; não autoriza backend/schema da Nexa, implementação funcional, login/link cloud ou deploy. A escolha de infraestrutura cloud continua pendente.

- Reservar para a Nexa a faixa local **54420–54429**, verificada livre antes da alteração. API `54421`, DB `54422`, Studio `54423`, e-mail local `54424` e Analytics `54427`; shadow DB `54420` e pooler `54429` ficam configurados para uso quando necessário.
- SMTP `54425` e POP3 `54426` permanecem apenas exemplos comentados; pooler continua desabilitado. `54428` fica sem publicação: não foi adicionado `analytics.vector_port`, ausente no arquivo gerado e marcado como legado/depreciado no código da CLI. O Vector deste stack não publica porta no host.
- Preservar `project_id = "Nexa"` e as configurações não relacionadas a portas. Não parar/remover stacks de outros projetos nem alterar a configuração global do Docker para contornar a limitação de logs do Vector no Windows.

Resultado, URLs e requisitos do Supabase Explorer em [[06 - Estado atual#Supabase Local — 12/09/2026]].

## 12/09/2026 — primeiro núcleo técnico da Fase 1

**Origem:** autorização posterior do responsável, “Você está iniciando a FASE 1 técnica do projeto NEXA”, limitada ao primeiro núcleo conversacional stateless e com proibição explícita de iniciar autenticação, persistência, integrações reais, Tools, visual ou deploy.

| ID | Decisão |
| --- | --- |
| D15 | Usar Supabase Edge Functions com TypeScript/Deno para o primeiro backend local da Nexa. Isso não decide ainda a operação cloud de produção. |
| D16 | Manter a sequência Nexa API → Nexa Core → Context Resolver/Instruction Builder → AIProvider. A Edge Function é adaptador HTTP e o Core não conhece providers concretos. |
| D17 | Definir o contrato `AIProvider` dentro da Nexa. O provider e seu JSON bruto são detalhes internos; identidade, contexto e resposta pública pertencem à Nexa. |
| D18 | Usar MockProvider determinístico como padrão local. Preparar GroqProvider por HTTP nativo, sem SDK, com modelo configurável e padrão `openai/gpt-oss-120b`. |
| D19 | Reconhecer inicialmente apenas `nexa`, `ascent` e `erp`, sem dados automáticos dos produtos. Ascent atua como Coach geral com limite médico básico; ERP oferece suporte básico sem alegar acessos inexistentes. |
| D20 | Este incremento permanece stateless. `conversation_id` é validado, mas não cria histórico; nenhuma migration ou tabela da aplicação será criada. |
| D21 | Configurar `health` e `chat` com `verify_jwt = false`, pois Auth está explicitamente fora do incremento. Os endpoints locais são públicos e devem ser revistos junto da autenticação antes de produção. |
| D22 | Aplicar allowlist CORS exata no código, rejeitando `*` na configuração. O Kong local acrescenta wildcard e intercepta preflight; sua política também deve ser revista antes de cloud. |
| D23 | Gerar ou preservar request ID seguro em toda resposta e registrar somente metadados operacionais estruturados, sem mensagem, contexto, prompt, chave ou stack. |
| D24 | Validar com Deno 2.1.4, testes locais sem rede e chamadas HTTP no Edge Runtime. Groq real só será chamado quando uma credencial segura estiver disponível. |

O `package.json` usa a versão `0.1.0-dev`, preserva Supabase como dependência de desenvolvimento e não acrescenta SDK ou framework. Configuração pública de exemplo fica em `.env.example`; segredos reais permanecem fora do repositório.

## 13/09/2026 — roteamento Groq/Gemini da Fase 1

**Origem:** autorização posterior do responsável para continuar a Fase 1 com GeminiProvider e ProviderRouter, mantendo o núcleo stateless e sem Auth, banco, persistência, integrações reais, Tools, Consensus, interface ou deploy.

| ID | Decisão |
| --- | --- |
| D25 | Inserir `ProviderRouter` entre o contrato `AIProvider` e os adaptadores concretos. O fluxo local configurado usa Groq como primary e Gemini como fallback, sem alterar a identidade ou o contrato público da Nexa. |
| D26 | Implementar GeminiProvider pela API REST GenerateContent com `fetch` nativo, sem SDK, modelo configurável e padrão `gemini-3.8-flash`. A chave é enviada em header e nunca integra URL, logs ou respostas. |
| D27 | Permitir somente um fallback sequencial para `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_UNAVAILABLE` e `INVALID_PROVIDER_RESPONSE`. Não criar repetição, recursão ou chamada simultânea. |
| D28 | Não acionar fallback para `AUTH_ERROR`, `CONFIG_ERROR`, `PROVIDER_REJECTED` e `UNKNOWN_PROVIDER_ERROR`. Recusas e bloqueios de segurança são `PROVIDER_REJECTED`; a troca de provider não pode contornar uma decisão de segurança. |
| D29 | Em `development` e `test`, um primary sem credencial pode ser ignorado em favor de um fallback configurado, com motivo explícito `PRIMARY_NOT_CONFIGURED`. Em produção, credencial ausente é erro de configuração e não aciona fallback. |
| D30 | Manter MockProvider determinístico para testes, seleção explícita e funcionamento offline em `development`/`test`. A configuração precisa declarar um primary; Mock não é fallback silencioso e é proibido em produção. |
| D31 | Expor na resposta pública somente provider/modelo efetivos e registrar nos logs apenas metadados operacionais seguros: primary, provider efetivo, uso e motivo categorizado do fallback. Não registrar mensagem, contexto, instruções, corpo bruto, chave ou stack do fornecedor. |
| D32 | Manter Consensus entre modelos somente como possibilidade futura. O Router atual escolhe uma resposta e nunca consulta Groq e Gemini simultaneamente. |

`NEXA_PRIMARY_PROVIDER` e `NEXA_FALLBACK_PROVIDER` passam a expressar o roteamento. `NEXA_AI_PROVIDER` fica como alias legado apenas na ausência da variável primary; conflito entre ambas ou repetição do mesmo provider nas duas posições é configuração inválida.

## Conflitos e pendências

**Nenhum conflito documental anterior foi encontrado.** Não havia outras notas, decisões ou documentação Nexa a consolidar. O link de exemplo sem destino e o registro antigo do Obsidian são achados da inspeção, não decisões de produto conflitantes.

A autorização da Fase 1 substituiu o limite operacional da antiga etapa exclusivamente documental, sem apagar seu registro histórico. Ela permitiu somente os incrementos stateless descritos acima. A autorização posterior para Supabase Local também permanece delimitada. Tools e Consensus continuam sendo possibilidades futuras, sem autorização de implementação.

As escolhas técnicas restantes continuam pendentes em [[02 - Arquitetura#Cloud e decisões pendentes]] e nas seções “A definir” de [[03 - Ascent]] e [[04 - ERP]]. Para novos conflitos, registre data, fontes, pontos divergentes e situação da resolução, preservando a informação anterior.
