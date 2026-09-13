# Nexa

A **Nexa** é a inteligência artificial da **NexPoint**. O primeiro incremento da Fase 1 implementa um núcleo conversacional stateless em Supabase Edge Functions, com `MockProvider` offline e `GroqProvider` preparado para configuração.

## Desenvolvimento local

Pré-requisitos: Docker Desktop ativo, Node.js/npm e dependências instaladas com `npm.cmd install`.

```powershell
npm.cmd run supabase:start
npm.cmd run check
```

O stack persistente serve as funções em:

- `GET http://127.0.0.1:54421/functions/v1/health`
- `POST http://127.0.0.1:54421/functions/v1/chat`

Exemplo de chat com o provider Mock padrão:

```powershell
$body = @{ app = "nexa"; message = "Olá Nexa" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:54421/functions/v1/chat" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Para desenvolvimento com recarga local e valores explícitos do exemplo:

```powershell
npx.cmd supabase functions serve --env-file .env.example
```

Para mudar a configuração local, copie `.env.example` para `.env`, mantenha esse arquivo ignorado e sirva com `npx.cmd supabase functions serve --env-file .env`. Não versione chaves. O Mock funciona sem internet ou credencial; `NEXA_AI_PROVIDER=groq` exige `GROQ_API_KEY` no ambiente seguro do runtime.

## Documentação

- [Visão do produto](<docs/brain/00 - Nexa.md>)
- [MVP e ordem das fases](<docs/brain/01 - MVP atual.md>)
- [Arquitetura](<docs/brain/02 - Arquitetura.md>)
- [Estado atual](<docs/brain/06 - Estado atual.md>)
- [Instruções para agentes](AGENTS.md)

O Vault de desenvolvimento fica em `docs/brain/` e não é memória de usuários da Nexa.
