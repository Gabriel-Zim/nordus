/** One line of "Parou no meio": work a restart cut, or a routine that failed or did not run. Texts are plain Brazilian Portuguese. */
export interface InterruptedItem {
  id: string;
  kind: "turn" | "routine";
  botId: string;
  botName: string;
  threadId: string;
  threadTitle: string;
  cause: string;
  /** What it already did, as short phrases: "gerou um vídeo", "pode ter enviado uma mensagem". */
  done: string[];
  /** Dismissing or resuming needs "Conferi e entendo que descartar não desfaz o que já foi feito". */
  mustConfirm: boolean;
  canResume: boolean;
  at: number;
}
