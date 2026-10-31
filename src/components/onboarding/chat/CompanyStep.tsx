import { useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import { COMPANY_MAX, companySuggestions, oneLine } from "@/lib/onboarding-chat";
import { saveCompanyName } from "@/lib/onboarding-chat-actions";
import { api, useStore } from "@/state/store";
import { staggerIndex } from "../beats/shared";
import { Chips, Problem, Say, StepFooter, textFieldClass, type StepProps } from "./chat-parts";

export function CompanyStep({ onComplete, onSkip, onBusy }: StepProps) {
  const { state, dispatch } = useStore();
  const profile = state.config?.profile;
  const suggestions = companySuggestions({ company: profile?.company, name: profile?.name, email: profile?.email });
  const [value, setValue] = useState(suggestions[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = oneLine(value, COMPANY_MAX);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text || saving) return;
    setSaving(true);
    setFailed(false);
    onBusy(true);
    try {
      const saved = await saveCompanyName(api, text);
      dispatch({ type: "profileSaved", profile: { company: saved } });
      onComplete({ outcome: "done", value: saved });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
      onBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Say state="happy">{t("onboarding.chat.company.ask")}</Say>
      <div className="animate-rise flex flex-col gap-3 pl-0 sm:pl-[52px]" style={staggerIndex(1)}>
        <Chips items={suggestions} selected={text} onPick={setValue} label={t("onboarding.chat.suggestions")} />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={COMPANY_MAX}
          placeholder={t("onboarding.chat.company.placeholder")}
          aria-label={t("onboarding.chat.company.label")}
          autoComplete="organization"
          disabled={saving}
          className={textFieldClass}
        />
        {failed && <Problem>{t("onboarding.chat.saveError")}</Problem>}
        <StepFooter label={saving ? t("onboarding.chat.saving") : t("onboarding.chat.continue")} disabled={!text} busy={saving} onSkip={onSkip} />
      </div>
    </form>
  );
}
