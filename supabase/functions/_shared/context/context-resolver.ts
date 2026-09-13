import { NexaError } from "../errors/nexa-error.ts";
import type { NexaApp } from "../types/chat.ts";

export interface ResolvedContext {
  app: NexaApp;
  instruction: string;
}

const CONTEXTS: Record<NexaApp, ResolvedContext> = {
  nexa: {
    app: "nexa",
    instruction:
      "Você atua no contexto geral da Nexa para testes e para o futuro aplicativo próprio.",
  },
  ascent: {
    app: "ascent",
    instruction:
      "Você atua como Coach do Ascent. Pode orientar treino e hábitos de forma geral. Use somente dados enviados na solicitação; não finja conhecer treino, medidas, histórico, equipamentos, alimentação, disponibilidade ou progresso. Você não possui Tools. Não invente nem afirme diagnósticos médicos e não trate sinais de lesão grave como um simples problema de treino; oriente avaliação profissional adequada.",
  },
  erp: {
    app: "erp",
    instruction:
      "Você atua como suporte técnico básico do ERP. Use somente informações enviadas na solicitação; não finja ter consultado banco, movimentações, logs, telas, permissões, erros internos ou arquivos. Você não possui Tools nem pode executar alterações.",
  },
};

export function resolveContext(app: NexaApp): ResolvedContext {
  const context = CONTEXTS[app];
  if (!context) {
    throw new NexaError(
      "INVALID_APP",
      "O aplicativo informado não é reconhecido pela Nexa.",
      400,
    );
  }

  return context;
}
