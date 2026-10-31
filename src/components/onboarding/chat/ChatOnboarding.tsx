import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "@/lib/i18n";
import { glassPopupFrameStyle } from "@/lib/glass-popup";
import {
  chatSteps,
  clearChatProgress,
  currentStep,
  progressShare,
  railRows,
  readChatProgress,
  recordStep,
  stepsLeft,
  writeChatProgress,
  type ChatProgress,
  type ChatStepId,
  type StepRecord,
} from "@/lib/onboarding-chat";
import { completeOnboarding } from "@/lib/onboarding-chat-actions";
import { api, useStore } from "@/state/store";
import { QuietButton } from "../beats/shared";
import { TeamBeat } from "../beats/TeamBeat";
import { AboutStep } from "./AboutStep";
import { AgentsStep } from "./AgentsStep";
import { ChatRail, ProgressBar, remainingText } from "./ChatRail";
import { Say } from "./chat-parts";
import { CompanyStep } from "./CompanyStep";
import { DoneStep } from "./DoneStep";
import { ImportStep } from "./ImportStep";
import { ToolsStep } from "./ToolsStep";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The first run in simple mode: the product's mascot asks one thing at a time, every question starts on a suggested
 * answer, and each answered step leaves a short line in the rail. The position is the first step without an answer,
 * kept in this browser, so a reload picks up where the person was.
 */
export function ChatOnboarding({ team = false, onDone }: { team?: boolean; onDone: () => void }) {
  const { dispatch } = useStore();
  const [progress, setProgress] = useState<ChatProgress>(() => readChatProgress());
  const [busy, setBusy] = useState(false);
  const latest = useRef(progress);
  latest.current = progress;
  const cardRef = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);

  const steps = chatSteps({ team });
  const position = currentStep(progress, steps);
  const left = stepsLeft(progress, steps);
  const share = progressShare(progress, steps);

  const record = (id: ChatStepId, entry: StepRecord) => {
    const next = recordStep(latest.current, id, entry);
    latest.current = next;
    writeChatProgress(next);
    setProgress(next);
  };

  const finish = async (select?: string) => {
    if (finishing.current) return;
    finishing.current = true;
    if (select) dispatch({ type: "select", id: select });
    onDone();
    try {
      dispatch({ type: "configStatus", config: await completeOnboarding(api) });
      clearChatProgress();
    } catch {
    }
  };

  useEffect(() => {
    const card = cardRef.current;
    if (!card || card.contains(document.activeElement)) return;
    const target = card.querySelector<HTMLElement>("input:not([type=checkbox]), textarea") ?? card.querySelector<HTMLElement>("[data-primary]") ?? card;
    target.focus({ preventScroll: true });
  }, [position]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) void finish();
      return;
    }
    if (event.key !== "Tab" || !cardRef.current) return;
    const card = cardRef.current;
    const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      card.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (document.activeElement === card) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const stepProps = (id: ChatStepId) => ({
    progress,
    onComplete: (entry: StepRecord) => record(id, entry),
    onSkip: () => record(id, { outcome: "skipped" }),
    onBusy: setBusy,
  });

  return (
    <div className="fixed inset-0 z-50 bg-app">
      <div className="glass-popup-frame" style={glassPopupFrameStyle()}>
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("onboarding.chat.dialog")}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="glass-surface glass-popup relative flex overflow-hidden rounded-2xl outline-none"
          style={{ width: "min(940px, 100%)", height: "min(640px, 100%)" }}
        >
          <ChatRail rows={railRows(progress, steps, position)} left={left} share={share} />
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-2 px-5 pb-1 pt-4 sm:hidden">
              <p className="text-[12.5px] text-ink-secondary" aria-live="polite">{remainingText(left)}</p>
              <ProgressBar share={share} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-12">
              <div key={position} className="mx-auto w-full max-w-[560px]">
                {position === "company" && <CompanyStep {...stepProps("company")} />}
                {position === "about" && <AboutStep {...stepProps("about")} />}
                {position === "import" && <ImportStep {...stepProps("import")} />}
                {position === "agents" && <AgentsStep {...stepProps("agents")} />}
                {position === "tools" && <ToolsStep {...stepProps("tools")} />}
                {position === "team" && (
                  <div className="flex flex-col gap-4">
                    <Say state="happy">{t("onboarding.chat.team.ask")}</Say>
                    <div className="sm:pl-[52px]">
                      <TeamBeat onNext={() => record("team", { outcome: "done" })} onSkip={() => record("team", { outcome: "skipped" })} />
                    </div>
                  </div>
                )}
                {position === "done" && <DoneStep progress={progress} finishing={finishing.current} onFinish={(select) => void finish(select)} />}
              </div>
            </div>
          </section>
          <QuietButton type="button" onClick={() => void finish()} disabled={busy} className="absolute right-4 top-3 disabled:opacity-50">
            {t("onboarding.chat.skipAll")}
          </QuietButton>
        </div>
      </div>
    </div>
  );
}
