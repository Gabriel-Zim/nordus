/**
 * The notch's IPC contract.
 *
 * - local page -> main: `notch:feed` ({ agents, approvals, labels }), `notch:state`, `notch:set-enabled` (boolean).
 * - notch window -> main: `notch:ready`, `notch:decide` ({ id, decision }), `notch:open`.
 * - main -> notch window: `notch:view`. main -> local page: `notch:decision` ({ id, decision }).
 *
 * Every text shown is chosen by the page and cleaned here; ids are opaque. The notch window carries no secret and
 * answers nothing itself: a decision goes back to the page that published the approval.
 */
export const NOTCH_CHANNELS = Object.freeze({
  feed: "notch:feed",
  state: "notch:state",
  setEnabled: "notch:set-enabled",
  ready: "notch:ready",
  decide: "notch:decide",
  open: "notch:open",
  view: "notch:view",
  decision: "notch:decision",
});

export const NOTCH_LIMITS = Object.freeze({ agents: 12, approvals: 8, id: 200, name: 40, status: 60, header: 90, text: 220, label: 40 });

/** How long a request must have been on screen before a tap on it counts; notch-page.js keeps the same number. */
export const NOTCH_ARM_MS = 700;

const LABEL_KEYS = ["done", "approve", "decline", "open", "several"];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const REF = /^[\w.:-]{1,128}$/;
const ID = /^[^\p{Cc}\p{Cf}]{1,200}$/u;
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/gu;
const FALLBACK_COLOR = "#6b7280";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const flat = value.replace(HIDDEN_CHARS, " ").replace(/\s+/g, " ").trim();
  const letters = [...flat];
  return letters.length > max ? `${letters.slice(0, max - 1).join("").trimEnd()}…` : flat;
}

function parseEntry(raw, kind) {
  if (!isRecord(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  const name = cleanText(raw.name, NOTCH_LIMITS.name);
  if (name === null) return null;
  const entry = {
    id: raw.id,
    name,
    color: typeof raw.color === "string" && COLOR.test(raw.color) ? raw.color.toLowerCase() : FALLBACK_COLOR,
    botId: typeof raw.botId === "string" && REF.test(raw.botId) ? raw.botId : null,
    threadId: typeof raw.threadId === "string" && REF.test(raw.threadId) ? raw.threadId : null,
  };
  if (kind === "agent") {
    const status = cleanText(raw.status, NOTCH_LIMITS.status);
    return status === null ? null : { ...entry, status };
  }
  const header = cleanText(raw.header, NOTCH_LIMITS.header);
  const text = cleanText(raw.text, NOTCH_LIMITS.text);
  if (header === null || text === null || typeof raw.decidable !== "boolean") return null;
  return { ...entry, header, text, decidable: raw.decidable };
}

function parseList(raw, kind, cap) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const list = [];
  for (const item of raw.slice(0, cap)) {
    const entry = parseEntry(item, kind);
    if (!entry) return null;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    list.push(entry);
  }
  return list;
}

/** A published snapshot, cleaned and capped, or null when anything about it is malformed. */
export function parseNotchFeed(raw) {
  if (!isRecord(raw) || !isRecord(raw.labels)) return null;
  const labels = {};
  for (const key of LABEL_KEYS) {
    const text = cleanText(raw.labels[key], NOTCH_LIMITS.label);
    if (!text) return null;
    labels[key] = text;
  }
  const agents = parseList(raw.agents, "agent", NOTCH_LIMITS.agents);
  const approvals = parseList(raw.approvals, "approval", NOTCH_LIMITS.approvals);
  return agents && approvals ? { agents, approvals, labels } : null;
}

export function parseDecision(raw) {
  if (!isRecord(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  return raw.decision === "approve" || raw.decision === "decline" ? { id: raw.id, decision: raw.decision } : null;
}

/** Security: only the notch window's own top frame may answer for it. */
export function fromNotchWindow(event, webContents) {
  const frame = event?.senderFrame;
  return Boolean(webContents) && !webContents.isDestroyed?.() && event?.sender === webContents && frame != null && frame === webContents.mainFrame;
}

/** The existing chat link: it opens, never sends or answers anything. */
export function chatLinkFor(target) {
  if (!target || !REF.test(target.botId ?? "") || !REF.test(target.threadId ?? "")) return null;
  return `nordus://thread/${encodeURIComponent(target.threadId)}?bot=${encodeURIComponent(target.botId)}`;
}
