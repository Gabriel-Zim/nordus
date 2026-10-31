import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { appliedSummary, approvalRowName, isSettledPermission } from "./ApprovalCard";
import type { ApprovalBot } from "./ApprovalTimelineCard";

export type ApprovalGroupKind = "applied" | "settled";

/** The key that gathers the lines the chat shows as one: changes a bot applied on its own (one group per bot) and permissions already decided. */
export function approvalGroupKey(message: Message, bot: ApprovalBot): string | null {
  const card = message.card;
  if (message.kind !== "options" || !card?.requestId || !card.tool || card.questionRequest) return null;
  const name = approvalRowName(message, bot);
  if (appliedSummary(card, name)) return `applied|${name}`;
  return isSettledPermission(card) ? "settled" : null;
}

export function approvalGroupKind(key: string): ApprovalGroupKind {
  return key.startsWith("applied|") ? "applied" : "settled";
}

function groupSummary(kind: ApprovalGroupKind, name: string, members: readonly Message[]): string {
  if (kind === "applied") return t("approval.group.changes", { name, count: members.length });
  const denied = members.filter((member) => member.card?.answered === "deny").length;
  if (denied === 0) return t("approval.group.permissions", { count: members.length });
  return t(denied === 1 ? "approval.group.permissionsOneDenied" : "approval.group.permissionsDenied", { count: members.length, denied });
}

/** Several lines of one kind as a single quiet line; a tap opens the lines themselves, each with what it offers. */
export function ApprovalGroup({
  kind,
  name,
  members,
  forceOpen,
  children,
}: {
  kind: ApprovalGroupKind;
  name: string;
  members: readonly Message[];
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const open = opened || forceOpen;
  const listId = useId();
  return (
    <div data-approval-group={kind} className="w-full max-w-[840px] text-[12.5px] leading-5 text-ink-tertiary">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpened(!open)}
        className="inline-flex max-w-full items-center gap-1 -ml-1 rounded-full px-1 hover:bg-inset hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0 truncate">{groupSummary(kind, name, members)}</span>
        <ChevronRight size={13} aria-hidden="true" className={cn("shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      <div id={listId} hidden={!open} className="mt-1.5 flex flex-col gap-2 border-l border-hairline/40 pl-3">
        {open && children}
      </div>
    </div>
  );
}
