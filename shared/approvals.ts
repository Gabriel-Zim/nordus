// Nordus: everything that waits on a person, in one shape. The server (the inbox index, the push, the expiry) and the
// app (the inbox page, the approval card) read the same words and the same rules from here.
import { criticalAction } from "./critical-action.ts";
import type { OptionCardData, WireMessage } from "./wire.ts";

/** How long a tool permission waits for a person before it is declined for them. */
export const APPROVAL_TTL_MS = 24 * 60 * 60_000;
export const APPROVAL_TTL_MIN_MS = 15 * 60_000;
export const APPROVAL_TTL_MAX_MS = 30 * 24 * 60 * 60_000;
/** How long a critical action's button is held down before it approves. */
export const HOLD_TO_APPROVE_MS = 1200;
export const DECLINE_REASON_MAX = 300;
/** What the bot is told when nobody answered in time. */
export const EXPIRED_DECLINE_REASON = "expirou";
/** What the bot is told when a person declined without saying why: the text the approval card has always sent. */
export const PLAIN_DECLINE_REASON = "Denied by the user.";

/** What "Quem decide" says when the agent has no owner of its own. */
export const ADMINS_LABEL = "Administradores";

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || email;
}

export type ApprovalKind =
  | "permission" | "peer" | "outbound" | "lesson" | "team-memory"
  | "question" | "sign-in" | "credential" | "connector"
  | "skill" | "routine" | "automation" | "profile" | "model" | "setting" | "helper" | "team-setup" | "quota-switch";

export type ApprovalRisk = "normal" | "critical";

export type ApprovalFieldCode =
  | "action" | "service" | "detail" | "why" | "lesson" | "client" | "origin" | "site" | "address" | "key" | "name"
  | "skill" | "helper" | "agent" | "setting" | "value" | "before" | "section" | "what" | "decider";

export interface ApprovalField {
  label: string;
  value: string;
  /** Catalog key for `label`: a client in another language translates by it and falls back to the label. */
  code?: ApprovalFieldCode;
  /** Catalog key for `value`, when the value is one of the server's fixed notes. */
  valueCode?: string;
}

/** What the approvals inbox keeps on an option card. */
export interface ApprovalCardMeta {
  /** epoch ms when the card, still waiting, is declined for the person. */
  expiresAt?: number;
  /** Why the person declined, in their words. */
  declinedWhy?: string;
  /** On a lesson card: the person's refusal proposed it, not the bot. */
  fromRefusal?: true;
  /** Nobody answered in time: the card was declined for the person. */
  lapsed?: true;
}

export interface ApprovalItem {
  /** `threadId.messageId`: stable for as long as the card exists. */
  id: string;
  kind: ApprovalKind;
  botId: string;
  botName: string;
  threadId: string;
  groupId?: string;
  messageId: string;
  requestId?: string;
  title: string;
  summary: string;
  fields: ApprovalField[];
  risk: ApprovalRisk;
  requestedAt: number;
  expiresAt?: number;
  /** Who answers for the bot: the owner's name, or "Administradores". */
  decider: string;
  /** Whether the person asking may decide it. */
  canDecide: boolean;
  /** `decide`: Approve and Decline work from the list. `open`: it has to be read in its conversation first. */
  action: "decide" | "open";
}

export interface InboxNote {
  id: string;
  at: number;
  kind: string;
  botId: string;
  botName: string;
  threadId: string;
  groupId?: string;
  title: string;
  body: string;
  requestId?: string;
  read: boolean;
  resolvedAt?: number;
}

/** What `GET /api/inbox` answers: what waits on the person, what was sent to them, and what came before. */
export interface InboxSections {
  waiting: ApprovalItem[];
  forYou: InboxNote[];
  before: InboxNote[];
}

export const APPROVALS_PATH = "/api/approvals";
export const INBOX_PATH = "/api/inbox";

export function approvalId(threadId: string, messageId: string): string {
  return `${threadId}.${messageId}`;
}

export function parseApprovalId(id: string): { threadId: string; messageId: string } | null {
  const match = /^([\w-]+)\.([\w-]+)$/.exec(id);
  return match ? { threadId: match[1]!, messageId: match[2]! } : null;
}

const PEER_TOOLS: ReadonlySet<string> = new Set(["ask_bot", "delegate_bot", "post_to_room"]);
const OPAQUE_OUTBOUND_TOOL = "COMPOSIO_PROXY_EXECUTE";

const DECIDED_IN_LIST: ReadonlySet<ApprovalKind> = new Set(["permission", "peer", "outbound", "lesson", "team-memory"]);
/** A banner shows one sentence: it decides a tool or a teammate call, never a lesson or a team memory, whose text is read first. */
const DECIDED_FROM_BANNER: ReadonlySet<ApprovalKind> = new Set(["permission", "peer"]);
const EXPIRING: ReadonlySet<ApprovalKind> = new Set(["permission", "outbound"]);

type Waiting = Pick<WireMessage, "kind" | "card" | "signIn" | "secret" | "connector">;

export function waitingKind(message: Waiting): ApprovalKind | null {
  if (message.kind === "signin") {
    const card = message.signIn;
    return card && !card.done && !card.cancelled && !card.superseded && !card.stopped ? "sign-in" : null;
  }
  if (message.kind === "secret") {
    const card = message.secret;
    return card && !card.provided && !card.dismissed && !card.superseded && !card.stopped ? "credential" : null;
  }
  if (message.kind === "connector") {
    const card = message.connector;
    return card && card.status !== "connected" && !card.dismissed && !card.stopped && !card.resumed ? "connector" : null;
  }
  const card = message.card;
  if (message.kind !== "options" || !card?.requestId) return null;
  if (card.answered || card.dismissed || card.expired || card.autoApplied) return null;
  if (card.requestType === "question" || card.questionRequest) return "question";
  if (card.lessonRequest) return "lesson";
  if (card.teamMemoryRequest) return "team-memory";
  if (card.skillRequest) return "skill";
  if (card.routineRequest) return "routine";
  if (card.webhookRequest || card.appTriggerRequest) return "automation";
  if (card.profileRequest) return "profile";
  if (card.modelRequest) return "model";
  if (card.appSettingRequest) return "setting";
  if (card.mcpServerRequest) return "helper";
  if (card.teamSetupRequest) return "team-setup";
  if (card.quotaSwitch) return "quota-switch";
  if (card.outboundRequest) return "outbound";
  if (card.tool && PEER_TOOLS.has(card.tool)) return "peer";
  return "permission";
}

/** Critical actions are held to approve: spending, changing settings, deleting for good, sending outside and going live. */
export function approvalRisk(card: OptionCardData | undefined): ApprovalRisk {
  if (!card) return "normal";
  if (card.heldCode === "approval.held.sensitive" || card.heldCode === "approval.held.outbound" || card.heldCode === "approval.held.sandbox") return "critical";
  if (card.outboundRequest) return "critical";
  if (card.tool && !PEER_TOOLS.has(card.tool) && criticalAction(card.tool, card.subtitle) !== null) return "critical";
  return "normal";
}

export function decidedInList(kind: ApprovalKind): boolean {
  return DECIDED_IN_LIST.has(kind);
}

/** `list`: Approve and Decline on an inbox row. `banner`: the buttons on a phone's notification. */
export type DecisionSurface = "list" | "banner";

/** Whether the person may answer this approval without opening its card. A critical action is approved by holding the button on its card, so a banner never decides one. */
export function decidableOutsideCard(item: Pick<ApprovalItem, "kind" | "canDecide" | "action" | "risk" | "requestId">, surface: DecisionSurface): boolean {
  if (!item.canDecide || item.action !== "decide" || !item.requestId) return false;
  return surface === "list" || (item.risk === "normal" && DECIDED_FROM_BANNER.has(item.kind));
}

export function expiresAfterWaiting(kind: ApprovalKind): boolean {
  return EXPIRING.has(kind);
}

export function approvalDeadline(message: Pick<WireMessage, "at"> & Waiting, ttlMs: number): number | undefined {
  const kind = waitingKind(message);
  if (!kind || !expiresAfterWaiting(kind)) return undefined;
  return message.card?.approval?.expiresAt ?? message.at + ttlMs;
}

export function waitLeft(deadline: number, now: number): { hours: number; minutes: number } | null {
  const left = deadline - now;
  if (left <= 0) return null;
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

function toolWords(tool: string): string {
  return tool.replace(/^mcp__.+?__(?=.)/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
}

function serviceOf(card: OptionCardData): string | undefined {
  if (card.outboundRequest?.app) return card.outboundRequest.app;
  const tool = card.tool;
  if (!tool) return undefined;
  const server = /^mcp__(.+?)__/.exec(tool)?.[1];
  if (server && server !== "composio") return upperFirst(server.replace(/[_-]+/g, " "));
  const bare = tool.toLowerCase();
  if (/^(bash|shell|terminal|exec_command|run_command|powershell|computer_exec)$/.test(bare)) return "Terminal";
  if (/^(read|write|edit|multiedit|view|create_file|str_replace|apply_patch|delete)$/.test(bare)) return "Arquivos";
  if (/^(websearch|web_search|webfetch|web_fetch|fetch|open_url)$/.test(bare)) return "Internet";
  return undefined;
}

export interface ApprovalCopy {
  title: string;
  summary: string;
  fields: ApprovalField[];
}

const field = (code: ApprovalFieldCode, label: string, value: string | undefined, valueCode?: string): ApprovalField[] =>
  value && value.trim() ? [{ code, label, value: clip(value, 400), ...(valueCode ? { valueCode } : {}) }] : [];

export function approvalCopy(message: Waiting, botName: string, decider: string): ApprovalCopy {
  const kind = waitingKind(message);
  const card = message.card;
  const deciderField = field("decider", "Quem decide", decider);
  if (kind === "sign-in" && message.signIn) {
    const { site, reason, url } = message.signIn;
    return {
      title: `${botName} precisa que você entre em ${site}`,
      summary: reason ?? "Entre você mesmo na página: a senha não passa pelo agente.",
      fields: [...field("site", "Site", site), ...field("address", "Endereço", url), ...deciderField],
    };
  }
  if (kind === "credential" && message.secret) {
    const { label, description, envName } = message.secret;
    return {
      title: `${botName} precisa de uma chave: ${label}`,
      summary: description,
      fields: [...field("key", "Chave", label), ...field("name", "Nome", envName), ...deciderField],
    };
  }
  if (kind === "connector" && message.connector) {
    const { label, description } = message.connector;
    return {
      title: `${botName} precisa que você conecte ${label}`,
      summary: description,
      fields: [...field("service", "Serviço", label), ...deciderField],
    };
  }
  if (!card) return { title: `${botName} espera por você`, summary: "", fields: deciderField };
  const detail = card.subtitle.trim();
  const opaque = card.heldCode === "approval.held.outbound" && card.outboundRequest?.tool === OPAQUE_OUTBOUND_TOOL;
  const why = opaque
    ? field("why", "Por que parou", "Isto executa código que pode enviar ou alterar coisas nos seus apps, por isso sempre pergunta antes.", "approval.opaqueCode")
    : field("why", "Por que parou", card.held, card.heldCode);
  switch (kind) {
    case "lesson": {
      const lesson = card.lessonRequest?.lesson ?? detail;
      return {
        title: card.approval?.fromRefusal ? `${botName} propõe uma lição a partir da sua recusa` : `${botName} propõe uma lição`,
        summary: lesson,
        fields: [...field("lesson", "Lição", lesson), ...field("client", "Cliente", card.lessonRequest?.client),
          ...(card.approval?.fromRefusal ? field("origin", "Veio de", "Uma recusa sua") : []), ...deciderField],
      };
    }
    case "team-memory":
      return {
        title: `${botName} quer guardar algo na memória do time`,
        summary: detail,
        fields: [...field("section", "Seção", card.teamMemoryRequest?.section), ...field("what", "O que", detail), ...deciderField],
      };
    case "question":
      return { title: `${botName} tem uma pergunta`, summary: detail, fields: deciderField };
    case "skill":
      return {
        title: `${botName} quer aprender uma habilidade`,
        summary: card.skillRequest?.gist ?? detail,
        fields: [...field("skill", "Habilidade", card.skillRequest?.name), ...deciderField],
      };
    case "routine":
      return { title: `${botName} propõe uma rotina`, summary: detail, fields: deciderField };
    case "automation":
      return { title: `${botName} propõe uma automação`, summary: detail, fields: deciderField };
    case "profile":
      return { title: `${botName} propõe mudar o perfil`, summary: detail, fields: deciderField };
    case "model":
      return {
        title: `${botName} propõe trocar o modelo`,
        summary: card.modelRequest?.reason ?? detail,
        fields: [...field("agent", "Agente", card.modelRequest?.targetName), ...deciderField],
      };
    case "setting": {
      const request = card.appSettingRequest;
      return {
        title: `${botName} propõe mudar um ajuste`,
        summary: request?.reason ?? detail,
        fields: [...field("agent", "Agente", request?.targetName), ...field("setting", "Ajuste", request?.setting),
          ...field("value", "Novo valor", request?.value), ...field("before", "Antes", request?.before), ...deciderField],
      };
    }
    case "helper":
      return {
        title: `${botName} quer ligar um ajudante`,
        summary: card.mcpServerRequest?.reason ?? detail,
        fields: [...field("helper", "Ajudante", card.mcpServerRequest?.serverName), ...deciderField],
      };
    case "team-setup":
      return { title: `${botName} propõe montar o time`, summary: card.teamSetupRequest?.reason ?? detail, fields: deciderField };
    case "quota-switch":
      return { title: `${botName} bateu no limite`, summary: detail, fields: deciderField };
    default: {
      const intent = card.intent?.trim();
      const title = kind === "peer" && card.title.includes(" quer ") ? card.title
        : intent ? `${botName} quer ${lowerFirst(intent)}`
          : kind === "outbound" ? `${botName} quer enviar algo em seu nome`
            : card.tool ? `${botName} pede para usar ${toolWords(card.tool)}` : `${botName} pede permissão`;
      const calls = card.outboundRequest?.calls?.map((call) => call.label).join("; ");
      const action = intent ? upperFirst(intent) : card.tool ? upperFirst(toolWords(card.tool)) : undefined;
      return {
        title,
        summary: card.explanation?.trim() || clip(detail, 240),
        fields: [...field("action", "Ação", action), ...field("service", "Serviço", serviceOf(card)),
          ...field("detail", "Detalhe", calls || (detail && detail !== action ? detail : undefined)), ...why, ...deciderField],
      };
    }
  }
}
