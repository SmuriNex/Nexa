# Nexa

A **Nexa** é a inteligência artificial da **NexPoint**. A Fase 1 mantém um núcleo conversacional stateless em Supabase Edge Functions e agora roteia providers por uma política explícita: Groq como primary, Gemini como fallback técnico e Mock para testes ou desenvolvimento offline.

## Desenvolvimento local

Pré-requisitos: Docker Desktop ativo, Node.js/npm e dependências instaladas com `npm.cmd install`.

```powershell
npm.cmd run supabase:start
npm.cmd run check
```

O stack persistente serve as funções em:

- `GET http://127.0.0.1:54421/functions/v1/health`
- `POST http://127.0.0.1:54421/functions/v1/chat`

Exemplo de chat com a configuração local ativa:

```powershell
$body = @{ app = "nexa"; message = "Olá Nexa" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:54421/functions/v1/chat" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Para desenvolvimento com recarga local, o Supabase carrega automaticamente o arquivo ignorado `supabase/functions/.env`:

```powershell
npm.cmd run functions:serve
```

`.env.example` documenta os nomes sem valores reais. Use `NEXA_PRIMARY_PROVIDER` e `NEXA_FALLBACK_PROVIDER` no arquivo local seguro; `NEXA_AI_PROVIDER` permanece apenas como alias legado. Para trabalhar offline, selecione `NEXA_PRIMARY_PROVIDER=mock` e não configure fallback. Nunca versione chaves.

## Documentação

- [Visão do produto](<docs/brain/00 - Nexa.md>)
- [MVP e ordem das fases](<docs/brain/01 - MVP atual.md>)
- [Arquitetura](<docs/brain/02 - Arquitetura.md>)
- [Estado atual](<docs/brain/06 - Estado atual.md>)
- [Instruções para agentes](AGENTS.md)

O Vault de desenvolvimento fica em `docs/brain/` e não é memória de usuários da Nexa.
