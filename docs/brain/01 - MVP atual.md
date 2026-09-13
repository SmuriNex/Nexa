# MVP atual

O objetivo do MVP é tornar a [[00 - Nexa|Nexa]] uma IA conversacional utilizável em nuvem, inicialmente no Ascent e no ERP.

**Situação em 12/09/2026:** a Fase 0 documental foi concluída. A Fase 1 começou com o primeiro núcleo conversacional stateless, restrito a duas Edge Functions locais, Core independente, contextos iniciais e providers Mock/Groq. Isso não autoriza iniciar os demais itens da Fase 1 ou a Fase 2 automaticamente.

## PRECISAMOS AGORA

Requisitos do MVP; os itens marcados foram iniciados apenas no limite descrito em [[06 - Estado atual]]:

- núcleo inicial da Nexa — implementado em versão stateless;
- IA conversacional — fluxo local provado com MockProvider;
- API própria — contratos locais `health` e `chat` implementados;
- usuários autenticados;
- conversas;
- histórico básico;
- contexto por aplicativo — reconhecimento inicial de `nexa`, `ascent` e `erp`, ainda sem dados reais;
- separação por usuário;
- separação por produto;
- AI Provider abstrato — contrato, MockProvider e GroqProvider implementados;
- Ascent Coach;
- ERP Support;
- execução em nuvem — pendente; nenhum link ou deploy foi realizado.

## NÃO PRECISAMOS AGORA

- controle de PC;
- Jarvis;
- voz;
- agentes autônomos;
- integração com Codex;
- automações independentes;
- treinamento de LLM próprio;
- acesso irrestrito a bancos;
- autonomia geral sobre aplicativos;
- HUD avançado;
- cérebro de partículas;
- shaders/WebGL;
- animações complexas;
- escuta por áudio.

Tools controladas para alterações nos produtos são intenções futuras a detalhar. Não há operações aprovadas nem implementação de Tools nesta etapa; ver [[03 - Ascent]] e [[04 - ERP]]. O acesso irrestrito aos bancos não é uma permissão adiada: não faz parte da direção conhecida do produto.

> Não implementar hoje aquilo que existe apenas como visão futura.

## Ordem oficial de desenvolvimento

| Etapa | Objetivo e escopo conceitual |
| --- | --- |
| **Fase 0 — concluída** | Definição e documentação inicial do projeto. |
| **Fase 1 — em andamento** | Primeiro incremento concluído: backend local stateless, API Nexa, Core, contextos e providers. Cloud, autenticação e persistência continuam pendentes. |
| Fase 2 — conversação utilizável | Usuários, autenticação, conversas, histórico, contexto e isolamento entre usuários e aplicativos. |
| Fase 3 — Ascent | Nexa funcionando de forma prática como Coach dentro do Ascent. |
| Fase 4 — ERP | Nexa funcionando de forma prática como suporte técnico básico dentro do ERP. |
| Fase 5 — estabilização | Testes, segurança, confiabilidade, custos, monitoramento e deploy estável. |
| **Somente depois: fase visual / HUD Nexa** | Aplicativo próprio, identidade visual avançada, cérebro de partículas, animações reativas, UX diferenciada, polimento e preparação visual para voz e escuta. |

Os incrementos seguintes dependem de nova autorização. As decisões pendentes estão em [[02 - Arquitetura]] e a situação realizada em [[06 - Estado atual]]. A direção visual está em [[00 - Nexa#Direção visual do aplicativo próprio]].

**Prioridade: funcionalidade primeiro, visual avançado depois.**

> Uma interface visual impressionante não tem prioridade sobre uma Nexa funcional.
