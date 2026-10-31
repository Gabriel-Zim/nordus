import { useState, type FormEvent, type KeyboardEvent } from "react";
import { t } from "@/lib/i18n";
import { ABOUT_MAX, aboutSuggestions, oneLine } from "@/lib/onboarding-chat";
import { SharedInstructionsFullError, saveCompanyContext } from "@/lib/onboarding-chat-actions";
import { api, useStore } from "@/state/store";
import { staggerIndex } from "../beats/shared";
import { Chips, Problem, Say, StepFooter, textFieldClass, type StepProps } from "./chat-parts";

export function AboutStep({ progress, onComplete, onSkip, onBusy }: StepProps) {
  const { state } = useStore();
  const company = progress.company?.value ?? state.config?.profile?.company ?? "";
  const suggestions = aboutSuggestions(company).map((suggestion) => suggestion.text);
  const [value, setValue] = useState(suggestions[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<"" | "failed" | "full">("");
  const text = oneLine(value, ABOUT_MAX);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text || saving) return;
    setSaving(true);
    setProblem("");
    onBusy(true);
    try {
      await saveCompanyContext(api, { company, about: text });
      onComplete({ outcome: "done", value: text });
    } catch (cause) {
      setProblem(cause instanceof SharedInstructionsFullError ? "full" : "failed");
    } finally {
      setSaving(false);
      onBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Say state="curious">{t("onboarding.chat.about.ask")}</Say>
      <div className="animate-rise flex flex-col gap-3 sm:pl-[52px]" style={staggerIndex(1)}>
        <Chips items={suggestions} selected={text} onPick={setValue} label={t("onboarding.chat.suggestions")} stacked />
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={ABOUT_MAX}
          rows={3}
          placeholder={t("onboarding.chat.about.placeholder")}
          aria-label={t("onboarding.chat.about.label")}
          disabled={saving}
          className={`${textFieldClass} resize-none leading-relaxed`}
        />
        {problem && <Problem>{problem === "full" ? t("onboarding.chat.about.full") : t("onboarding.chat.saveError")}</Problem>}
        <StepFooter label={saving ? t("onboarding.chat.saving") : t("onboarding.chat.continue")} disabled={!text} busy={saving} onSkip={onSkip} />
      </div>
    </form>
  );
}
