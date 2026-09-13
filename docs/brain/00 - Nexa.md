# Nexa

A **Nexa é a inteligência artificial da NexPoint**. O objetivo atual do produto é oferecer IA conversacional dentro dos produtos da empresa, inicialmente como Coach no [[03 - Ascent|Ascent]] e suporte técnico básico no [[04 - ERP|ERP]].

A Nexa é um sistema próprio da NexPoint. Ela não é o modelo de IA: o modelo externo é somente um motor utilizado através de uma abstração de **AI Provider**. Sua identidade deve permanecer independente de fornecedores e modelos, que poderão ser substituídos sem reconstruir os aplicativos clientes. Consulte [[02 - Arquitetura]].

## Usuários e limites

O público previsto inclui a equipe da NexPoint, os usuários do Ascent e do ERP e, futuramente, de outros produtos NexPoint. Um usuário comum fica limitado ao contexto autorizado do aplicativo em uso, com separação por usuário e produto. Capacidades internas mais avançadas para a NexPoint pertencem à visão futura.

O estágio verificado está em [[06 - Estado atual]]. O escopo do MVP e a ordem de desenvolvimento estão em [[01 - MVP atual]].

> Separar o que queremos no futuro daquilo que precisamos hoje.

## Cérebro documental e memória da Nexa

O Vault em `docs/brain` é o **cérebro do desenvolvimento da Nexa**, usado por Junior, ChatGPT, Codex e pelo trabalho de desenvolvimento. Reúne produto, MVP, arquitetura, decisões, integrações e estado atual.

A **Nexa Memory** será uma funcionalidade futura do produto para armazenar contexto dos usuários. Não é este Vault; seus detalhes ainda não estão definidos.

## Visão futura

**FORA DO ESCOPO ATUAL.** A Nexa poderá evoluir na direção de um assistente como Jarvis, com uso do computador, integração com Codex, agentes, ferramentas, automações, maior autonomia e assistência interna à NexPoint. A arquitetura deve permitir evolução sem antecipar a implementação dessas capacidades.

### Direção visual do aplicativo próprio

**Somente documentada; não implementada nesta fase.** O aplicativo próprio e sua UX/UI/HUD serão detalhados depois das funções essenciais, conforme [[01 - MVP atual]].

- Usar a identidade e as cores oficiais da NexPoint; valores de cores e arquivos de marca não foram fornecidos nesta base e não são definidos aqui.
- Evitar aparência genérica de chatbot ou assistente virtual. Não usar avatar humano, “mulher robô” ou personagem 3D humanoide como representação principal.
- Representar a Nexa por um cérebro abstrato de partículas, pontos e conexões, semelhante a uma malha neural ou estrutura computacional. Ele não deve ser anatomicamente realista.
- Permitir futuramente que essa representação reaja aos estados da IA.

Estados visuais desejados:

- repouso;
- recebendo mensagem;
- pensando;
- respondendo;
- executando ação;
- ouvindo;
- falando.

As reações poderão lembrar visualizadores de áudio, ondas, pulsos, atividade neural e movimentação procedural. Quando voz e escuta forem adicionadas, a amplitude do áudio poderá orientar a representação de ouvir, processar e falar.

No aplicativo próprio, a experiência visual deve representar simplesmente **Nexa**. Não é necessário exibir Ascent, ERP, Coach ou Support: esses contextos fazem parte da arquitetura interna.

Three.js, WebGL, shaders, partículas, cérebro animado, efeitos de áudio, HUD futurista, animações avançadas, voz e escuta não serão implementados nesta etapa. Esta documentação preserva a intenção visual sem escolher sua tecnologia.
