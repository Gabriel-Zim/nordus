export interface NotchLabels {
  done: string;
  approve: string;
  decline: string;
  open: string;
  /** Holds `{count}`, filled in with the number of agents working. */
  several: string;
}

export interface NotchAgentWire {
  id: string;
  name: string;
  /** `#rrggbb`. */
  color: string;
  status: string;
  botId?: string | null;
  threadId?: string | null;
}

export interface NotchApprovalWire {
  id: string;
  name: string;
  color: string;
  header: string;
  text: string;
  /** False when the notch must not answer it: anything but an ordinary permission, or a request not read yet. */
  decidable: boolean;
  botId?: string | null;
  threadId?: string | null;
}

export interface NotchFeedWire {
  agents: NotchAgentWire[];
  approvals: NotchApprovalWire[];
  labels: NotchLabels;
}

export interface NotchDecisionWire {
  id: string;
  decision: "approve" | "decline";
}

export interface NotchState {
  supported: true;
  enabled: boolean;
  saved: boolean;
  display: "notch" | "pill" | "none";
}

export declare const NOTCH_CHANNELS: Readonly<Record<"feed" | "state" | "setEnabled" | "ready" | "decide" | "open" | "view" | "decision", string>>;
export declare const NOTCH_LIMITS: Readonly<Record<"agents" | "approvals" | "id" | "name" | "status" | "header" | "text" | "label", number>>;
export declare const NOTCH_ARM_MS: number;
export declare function cleanText(value: unknown, max: number): string | null;
export declare function parseNotchFeed(raw: unknown): { agents: Required<NotchAgentWire>[]; approvals: Required<NotchApprovalWire>[]; labels: NotchLabels } | null;
export declare function parseDecision(raw: unknown): NotchDecisionWire | null;
export declare function chatLinkFor(target: { botId?: string | null; threadId?: string | null } | null | undefined): string | null;
