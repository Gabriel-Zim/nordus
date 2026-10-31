// Nordus: the server side of a key asked for by variable name. The bot's request becomes a secret card in its own
// conversation; the person's save goes into the settings (PUT /api/config, section botEnv), and the conversation keeps
// only "chave X salva".
import { randomUUID } from "node:crypto";

import {
  ENV_SECRET_TARGET,
  envSecretDescription,
  envSecretNameRefusal,
  envSecretScope,
  type EnvSecretScope,
} from "../shared/env-secret.ts";
import type { WireMessage } from "../shared/wire.ts";
import type { BotAccess } from "./bot-audience.ts";

type SecretCard = NonNullable<WireMessage["secret"]>;
/** Whether a saved key reaches this bot: read from the settings. */
export interface EnvKeyReader { has(name: string, bot: BotAccess): boolean }

export const isEnvSecretCard = (secret: { target?: unknown } | undefined | null): boolean => secret?.target === ENV_SECRET_TARGET;

/** What the card's row says in the chat: the name only, never a value. */
export const envSecretCardText = (name: string): string => `Pedido seguro da chave ${name}. Ela não entra na conversa.`;

/** The note the bot's turn resumes with once the person saved or declined the key. */
export function envSecretUpdateText(name: string, outcome: "provided" | "dismissed"): string {
  return outcome === "provided"
    ? `Nordus key update: the person securely saved ${name}. From your next command on it is set in your environment as $${name}; use it from there (for example "$${name}" in a shell command) and never print, echo or write its value anywhere. You do not receive the value. Build the integration yourself, make one real call to prove the key works (if it is refused, ask again with request_credential replace: true), then continue the task that paused for it without asking the person to set anything up.`
    : `Nordus key update: the person chose not to save ${name} now. Continue without it if you can, or say in one short line what stays blocked. Never ask them to paste a key into chat.`;
}

export interface EnvSecretRequest {
  envName: unknown;
  purpose?: unknown;
  scope?: unknown;
  /** The saved key failed a real call: open a card for a new one even though one is saved. */
  replace?: unknown;
}

export type EnvSecretRequestResult =
  | { ok: false; status: number; error: string }
  | { ok: true; alreadyConfigured: true; name: string }
  | { ok: true; alreadyConfigured: false; name: string; secret: SecretCard; text: string };

/** Validates the bot's ask and builds the card; the caller appends it and supersedes older cards for the same name. */
export function buildEnvSecretRequest(
  vault: EnvKeyReader,
  bot: BotAccess & { name: string },
  request: EnvSecretRequest,
): EnvSecretRequestResult {
  const refusal = envSecretNameRefusal(request.envName);
  if (refusal) return { ok: false, status: 400, error: refusal };
  const name = request.envName as string;
  const scope: EnvSecretScope = envSecretScope(request.scope);
  // A client's bot never asks for a key every internal bot would carry.
  if (scope === "shared" && !bot.internal) return { ok: false, status: 403, error: "A client's bot can only ask for a key of its own (scope bot)." };
  if (request.replace !== true && vault.has(name, bot)) return { ok: true, alreadyConfigured: true, name };
  const purpose = typeof request.purpose === "string" ? request.purpose.trim().slice(0, 240) : "";
  return {
    ok: true,
    alreadyConfigured: false,
    name,
    text: envSecretCardText(name),
    secret: {
      target: ENV_SECRET_TARGET,
      envName: name,
      envScope: scope,
      ...(purpose ? { envPurpose: purpose } : {}),
      label: name,
      description: envSecretDescription(purpose, scope, bot.name),
      placeholder: "Cole a chave aqui",
      helpUrl: "",
      requestKey: randomUUID(),
    },
  };
}

/** An env card still waiting for this same variable: the set a newer request replaces. */
export function isPendingEnvSecretCard(
  message: { kind?: unknown; secret?: Partial<SecretCard>; from?: { botId?: unknown } },
  name: string,
  requestingBotId: string,
  roomThread: boolean,
): boolean {
  const secret = message.secret;
  return (
    message.kind === "secret" &&
    isEnvSecretCard(secret) &&
    secret?.envName === name &&
    secret.provided !== true &&
    secret.dismissed !== true &&
    secret.superseded !== true &&
    (!roomThread || message.from?.botId === requestingBotId)
  );
}

/** Whether the key an env card asked for is in the vault for this bot. */
export function envSecretCardConfigured(vault: EnvKeyReader, secret: Partial<SecretCard>, bot: BotAccess): boolean {
  return typeof secret.envName === "string" && vault.has(secret.envName, bot);
}
