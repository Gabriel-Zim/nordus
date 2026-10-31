import { useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import { sessionOnce } from "@/lib/session";
import { StoreContext } from "@/state/store";
import { ADMINS_LABEL, waitLeft, type ApprovalField } from "../../shared/approvals";

export function useNow(enabled: boolean, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [enabled, everyMs]);
  return now;
}

export function expiryText(deadline: number | undefined, now: number): string | null {
  if (deadline === undefined) return null;
  const left = waitLeft(deadline, now);
  if (!left) return t("approvals.pill.expiring");
  if (left.hours >= 1) return t("approvals.pill.expiresHours", { hours: left.minutes > 0 ? left.hours + 1 : left.hours });
  return t("approvals.pill.expiresMinutes", { minutes: left.minutes });
}

export function deciderText(decider: string): string {
  return decider === ADMINS_LABEL ? t("approvals.decider.admins") : decider;
}

export function ApprovalPill({ you, decider, deadline, critical }: { you: boolean; decider: string; deadline?: number; critical?: boolean }) {
  const now = useNow(deadline !== undefined);
  const expiry = expiryText(deadline, now);
  const waiting = you ? t("approvals.pill.waitingYou") : t("approvals.pill.waitingWho", { name: deciderText(decider) });
  return (
    <span
      data-approval-pill=""
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4",
        critical ? "bg-danger/15 text-danger" : "bg-ink/[0.07] text-ink-secondary",
      )}
    >
      {expiry ? `${waiting} · ${expiry}` : waiting}
    </span>
  );
}

export function fieldLabel(field: ApprovalField): string {
  return field.code ? tFromServer(`approvals.field.${field.code}`, field.label) ?? field.label : field.label;
}

export function ApprovalFacts({ fields, className }: { fields: readonly ApprovalField[]; className?: string }) {
  if (!fields.length) return null;
  return (
    <dl data-approval-facts="" className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px] leading-5", className)}>
      {fields.map((field, index) => (
        <div key={`${field.code ?? field.label}-${index}`} className="contents">
          <dt className="text-ink-tertiary">{fieldLabel(field)}</dt>
          <dd className="min-w-0 break-words text-ink">
            {field.code === "decider" ? deciderText(field.value) : tFromServer(field.valueCode, field.value) ?? field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface ApprovalViewer {
  name?: string;
  /** What a decided card may call this person: their email, their sign-in's label or their name, lowercased. */
  aliases: readonly string[];
}

const NOBODY: ApprovalViewer = { aliases: [] };

export function useViewer(): ApprovalViewer {
  const profile = useContext(StoreContext)?.state?.config?.profile?.name?.trim();
  const [session, setSession] = useState<ApprovalViewer>(NOBODY);
  useEffect(() => {
    let alive = true;
    void sessionOnce().then((current) => {
      if (!alive || current.kind !== "session") return;
      const email = current.email?.trim();
      const name = current.name?.trim() || email?.split("@")[0]?.trim() || undefined;
      setSession({
        ...(name ? { name } : {}),
        aliases: [email, current.label?.trim(), current.name?.trim()].filter((alias): alias is string => Boolean(alias)).map((alias) => alias.toLowerCase()),
      });
    }, () => {});
    return () => { alive = false; };
  }, []);
  const name = session.name ?? (profile || undefined);
  return name === session.name ? session : { ...session, ...(name ? { name } : {}) };
}

export function otherDecider(answeredBy: { kind: string; name?: string } | undefined, viewer: ApprovalViewer): string | undefined {
  if (answeredBy?.kind !== "session" || !answeredBy.name) return undefined;
  if (viewer.aliases.includes(answeredBy.name.toLowerCase())) return undefined;
  return answeredBy.name.split("@")[0] || answeredBy.name;
}
