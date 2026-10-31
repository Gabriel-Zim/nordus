import { Check, Copy, X } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { joinUrl, type JoinApproveRole, type JoinLink, type JoinRequest } from "@/lib/people-join";
import { RoleSelect } from "./RoleSelect";

export function JoinLinkField({ origin, link }: { origin: string; link: JoinLink }) {
  const url = joinUrl(origin, link.token);
  const { state, copy } = useCopyFeedback(url);
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label={t("people.joinLink.field")}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink focus:outline-none"
      />
      <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink">
        {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
        {t(state === "copied" ? "people.copied" : state === "failed" ? "common.copyFailed" : "people.copy")}
      </button>
    </div>
  );
}

export function JoinRequestRow({ request, busy, role, onRole, onApprove, onDecline }: {
  request: JoinRequest;
  busy: boolean;
  role: JoinApproveRole;
  onRole: (role: JoinApproveRole) => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-hairline/20 py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-ink">{request.email}</span>
      <RoleSelect size="sm" value={role} onChange={onRole} label={t("people.requests.role", { email: request.email })} disabled={busy} />
      <button type="button" disabled={busy} onClick={onApprove} className="ui-button ui-button-primary ui-button-sm">{t("people.requests.approve")}</button>
      <button type="button" disabled={busy} onClick={onDecline} className="text-[12px] text-danger hover:underline disabled:opacity-50">{t("people.requests.decline")}</button>
    </li>
  );
}
