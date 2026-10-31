/** Why the Nordus sign-in sent the person back: the `login_erro` query value the /auth/google/callback redirect carries. */
export type LoginRefusal =
  | "nao_configurado"
  | "expirou"
  | "cancelado"
  | "nao_permitido"
  | "lista_de_espera"
  | "pendente"
  | "email_nao_verificado"
  | "falhou"
  | "muitas_tentativas";

/** What the sign-in page says for each refusal; never the technical cause. */
export const LOGIN_REFUSAL_TEXT: Record<LoginRefusal, string> = {
  nao_configurado: "O login com Google ainda não foi ligado neste servidor.",
  expirou: "O login demorou demais ou foi aberto em outra janela. Tente de novo.",
  cancelado: "O login foi cancelado.",
  nao_permitido: "Esta conta Google não tem acesso à Nordus. Peça ao responsável para liberar o seu e-mail.",
  lista_de_espera: "Sua conta Google entrou na lista de espera da Nordus. Assim que o seu acesso for liberado, é só entrar de novo com a mesma conta.",
  pendente: "Pedido enviado. Quem administra este espaço precisa aprovar. Depois disso, entre de novo com esta conta Google.",
  email_nao_verificado: "O Google ainda não confirmou o e-mail desta conta.",
  falhou: "Não foi possível falar com o Google agora. Tente de novo em instantes.",
  muitas_tentativas: "Muitas tentativas seguidas. Espere um minuto e tente de novo.",
};

export function isLoginRefusal(value: unknown): value is LoginRefusal {
  return typeof value === "string" && Object.hasOwn(LOGIN_REFUSAL_TEXT, value);
}

/** The title of the calm page shown once a join request is waiting for approval. */
export const JOIN_PENDING_TITLE = "Pedido enviado";

/** The title of the calm page shown for the waiting list. */
export const WAITLIST_TITLE = "Você está na lista de espera";

/** GET /auth/status, public: which sign-in buttons this server offers. */
export interface LoginStatus {
  google: boolean;
}
