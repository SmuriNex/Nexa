# Nexa - Instruções para agentes

Este repositório contém o projeto Nexa, a inteligência artificial da NexPoint.

## Contexto para cada tarefa

Antes de alterações importantes, consulte os documentos relevantes em `docs/brain/`, fonte de contexto do projeto. Use este índice para selecionar a leitura; não é necessário ler todo o Vault em cada tarefa.

| Documento | Consultar para |
| --- | --- |
| [00 - Nexa.md](<docs/brain/00 - Nexa.md>) | Identidade do produto e visão futura, inclusive visual. |
| [01 - MVP atual.md](<docs/brain/01 - MVP atual.md>) | Escopo do MVP, limites da etapa autorizada e ordem das fases. |
| [02 - Arquitetura.md](<docs/brain/02 - Arquitetura.md>) | Arquitetura implementada do núcleo stateless e decisões técnicas ainda pendentes. |
| [03 - Ascent.md](<docs/brain/03 - Ascent.md>) | Integração como Coach no Ascent. |
| [04 - ERP.md](<docs/brain/04 - ERP.md>) | Integração como suporte técnico básico no ERP. |
| [05 - Decisoes.md](<docs/brain/05 - Decisoes.md>) | Decisões tomadas, origem e conflitos documentais. |
| [06 - Estado atual.md](<docs/brain/06 - Estado atual.md>) | Situação verificada, pendências e próximos passos. |

## Regras de trabalho

- Há permissão permanente para ler, inspecionar e analisar qualquer arquivo ou pasta dentro do diretório de trabalho, sem pedir confirmação para ações de leitura.
- Confirme a raiz Git e consulte `git status` antes de modificar arquivos; preserve alterações existentes e o repositório Git.
- A Fase 0 documental está concluída. A Fase 1 começou com um primeiro incremento técnico limitado ao núcleo conversacional stateless em Supabase Edge Functions; consulte `01 - MVP atual.md` e `06 - Estado atual.md` antes de ampliar esse escopo.
- Não expanda o escopo sem autorização. Não implemente itens da visão futura apenas porque estão documentados.
- Sem nova autorização, não implemente Auth, usuários reais, persistência, migrations ou tabelas da aplicação, integrações reais com Ascent/ERP, Tools, frontend/HUD, voz, escuta, agentes, controle do computador, Codex/Jarvis ou deploy cloud.
- Preserve decisões e material útil. Entenda a função de uma nota antes de alterá-la; não substitua decisões silenciosamente nem suponha que documentação nova tem prioridade automática sobre notas antigas.
- Registre conflitos em `05 - Decisoes.md`, preservando as origens e deixando a resolução pendente quando necessário; não invente decisões de produto ou técnicas.
- Registre mudanças arquiteturais relevantes em `02 - Arquitetura.md` e `05 - Decisoes.md`. Atualize `06 - Estado atual.md` após etapas importantes com o que foi efetivamente realizado e validado.
- Mantenha o brain enxuto: assuntos separados, links úteis, sem grandes blocos duplicados nem exigência de leitura integral recorrente.
- Preserve links e backlinks do Obsidian ao reorganizar arquivos. Não ignore ou descarte toda a pasta `.obsidian` automaticamente.
- Use o nome **Ascent**. Respeite a independência da Nexa em relação ao AI Provider e o isolamento de contexto por usuário e produto.
- O brain é documentação de desenvolvimento, separado da futura memória dos usuários da Nexa.
- Prioridade: **funcionalidade primeiro, visual avançado depois**.
- Não faça commit, push, link ou deploy automaticamente. Ao terminar cada incremento autorizado, pare após o relatório e não inicie o seguinte por conta própria.
