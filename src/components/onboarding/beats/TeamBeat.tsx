import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { JoinLinkField } from "@/components/JoinLinkPanel";
import { usePeopleJoin } from "@/components/usePeopleJoin";
import { t } from "@/lib/i18n";
import { inviteAddresses } from "@/lib/people-join";
import { inputClass, PrimaryButton, QuietButton, staggerIndex, type BeatProps } from "./shared";

const card = "animate-rise mt-4 w-full rounded-lg border border-hairline/40 p-3 text-left";

export function TeamBeat({ onNext, onSkip, origin = window.location.origin }: Pick<BeatProps, "onNext" | "onSkip"> & { origin?: string }) {
  const join = usePeopleJoin();
  const ensureLink = join.ensure;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureLink();
  }, [ensureLink]);

  const proceed = async () => {
    if (sending) return;
    if (!draft.trim()) {
      onNext();
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { invalid } = await inviteAddresses(draft, "member");
      if (invalid.length) {
        setDraft(invalid.join(", "));
        setError(t("people.inviteInvalid", { entries: invalid.join(", ") }));
        return;
      }
      onNext();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="stagger flex flex-col items-center" onSubmit={(event) => { event.preventDefault(); void proceed(); }}>
      <p className="animate-rise text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary" style={staggerIndex(0)}>
        {t("onboarding.invite.step")}
      </p>
      <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>
        {t("onboarding.invite.intro")}
      </p>

      <section className={card} style={staggerIndex(1)}>
        <label htmlFor="team-emails" className="mb-2 block text-[13px] font-medium text-ink">{t("onboarding.invite.emails")}</label>
        <input
          id="team-emails"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("people.invitePlaceholder")}
          disabled={sending}
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
      </section>

      <section className={card} style={staggerIndex(2)}>
        <h2 className="mb-2 text-[13px] font-medium text-ink">{t("onboarding.invite.linkTitle")}</h2>
        {join.state.link ? (
          <JoinLinkField origin={origin} link={join.state.link} />
        ) : join.error ? (
          <div className="flex items-center gap-3 text-[12.5px] text-danger" role="alert">
            <span className="min-w-0 flex-1">{t("onboarding.invite.linkError")}</span>
            <QuietButton type="button" onClick={() => void ensureLink()} disabled={join.busy}>{t("onboarding.invite.retry")}</QuietButton>
          </div>
        ) : (
          <Loader2 size={14} className="animate-spin text-ink-secondary" aria-hidden="true" />
        )}
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.joinLink.note")}</p>
      </section>

      {error && <p role="alert" className="animate-rise mt-3 w-full text-center text-[12.5px] text-danger">{error}</p>}

      <PrimaryButton type="submit" disabled={sending} className="animate-rise mt-5" style={staggerIndex(3)}>
        {sending ? t("onboarding.invite.sending") : t("onboarding.invite.continue")}
      </PrimaryButton>
      <QuietButton type="button" onClick={onSkip} disabled={sending} className="mt-3">
        {t("onboarding.invite.skip")}
      </QuietButton>
    </form>
  );
}
