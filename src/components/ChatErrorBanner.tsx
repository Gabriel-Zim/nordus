import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { accessSignInExpired } from "@/lib/access-session";
import { t } from "@/lib/i18n";
import { isUnreachableError, plainErrorLine } from "@/lib/plain-error";
import type { AppState } from "@/state/store";

export function ChatNotice({ notice }: { notice: AppState["notice"] }) {
  if (!notice) return null;
  return (
    <div className="w-full px-5">
      <div role="status" className="mb-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        {notice.kind === "note"
          ? notice.text
          : notice.kind === "steer-images"
            ? t("composer.queued.steerImagesHeld")
            : notice.kind === "bot-gone"
              ? t("thread.botGone")
              : notice.botName ? t("thread.goneShowing", { name: notice.botName }) : t("thread.gone")}
      </div>
    </div>
  );
}

export function ChatErrorBanner({ message, onDismiss, signInExpired: knownExpired }: {
  message: string | null;
  onDismiss: () => void;
  /** set by tests; the banner asks on its own when Nordus could not be reached */
  signInExpired?: boolean;
}) {
  const [asked, setAsked] = useState<{ message: string; expired: boolean } | null>(null);
  useEffect(() => {
    if (!message || knownExpired !== undefined || !isUnreachableError(message)) return;
    let current = true;
    void accessSignInExpired().then((expired) => { if (current) setAsked({ message, expired }); });
    return () => { current = false; };
  }, [message, knownExpired]);
  if (!message) return null;
  const expired = knownExpired ?? (asked?.message === message && asked.expired);
  const plain = expired ? t("chat.recovery.accessExpired") : plainErrorLine(message);
  return (
    <div className="w-full px-5">
      <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
        <div className="min-w-0 flex-1 break-words">
          <p>{plain ?? message}</p>
          {expired && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ui-button ui-button-md mt-1.5 rounded-full border-danger/30 bg-danger/10 text-danger hover:bg-danger/15"
            >
              {t("chat.recovery.signInAgain")}
            </button>
          )}
          {plain && <details className="mt-1 text-[12px] text-ink-secondary"><summary className="cursor-pointer">{t("chat.error.details")}</summary><p dir="auto" className="mt-1 break-words">{message}</p></details>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("chat.error.dismiss")}
          title={t("chat.error.dismiss")}
          className="shrink-0 rounded p-0.5 hover:bg-danger/10"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
