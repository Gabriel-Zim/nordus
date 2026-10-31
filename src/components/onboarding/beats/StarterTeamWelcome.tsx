import { useState } from "react";
import { ConnectAI } from "@/components/ConnectAI";
import { engineReady } from "@/components/EngineLibrary";
import { t } from "@/lib/i18n";
import {
  createStarterTeam,
  StarterTeamBuildError,
  StarterTeamUnavailableError,
  starterTeamMembers,
} from "@/lib/starter-team";
import { api, useStore } from "@/state/store";
import { PrimaryButton, QuietButton, staggerIndex } from "./shared";

type Status = "idle" | "creating" | "unavailable" | "failed";

/**
 * Simple mode's first screen: three working bots in one click, no form.
 * Advanced mode and the welcome replay keep HelloBeat.
 */
export function StarterTeamWelcome({
  onFinish,
  onBuilt = onFinish,
  onBusyChange,
}: {
  onFinish: () => void;
  onBuilt?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const members = starterTeamMembers();
  const instances = state.instances ?? [];
  const enginesReady = instances.some(engineReady);
  const connectFirst = status === "unavailable" || (status === "idle" && !enginesReady && instances.length > 0);

  const build = async () => {
    if (status === "creating") return;
    setStatus("creating");
    setError("");
    onBusyChange?.(true);
    try {
      const { bots, chief } = await createStarterTeam(api, { existing: state.bots ?? [] });
      for (const bot of bots) dispatch({ type: "botAdded", bot, preserveSelection: true });
      dispatch({ type: "select", id: chief.id });
      onBuilt();
    } catch (cause) {
      onBusyChange?.(false);
      if (cause instanceof StarterTeamUnavailableError) {
        setStatus("unavailable");
        return;
      }
      setStatus("failed");
      if (cause instanceof StarterTeamBuildError) {
        for (const bot of cause.confirmedBots) dispatch({ type: "botAdded", bot, preserveSelection: true });
        setError(cause.message);
        return;
      }
      console.error("starter team build failed", cause);
    }
  };

  // Finish the welcome before opening the new-bot dialog; otherwise it sits behind this card.
  const singleBot = () => {
    if (status === "creating") return;
    onFinish();
    dispatch({ type: "toggleNewBot", open: true });
  };

  const continueWithoutTeam = () => {
    if (status === "creating") return;
    onFinish();
  };

  return (
    <div className="stagger flex flex-col items-center">
      <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>
        {t("onboarding.team.intro")}
      </p>

      <ul className="animate-rise mt-4 w-full space-y-1 text-left" style={staggerIndex(1)}>
        {members.map((member) => (
          <li key={member.key} className="flex items-baseline gap-2 text-[13px]">
            <span aria-hidden="true" className="text-ink-secondary">•</span>
            <span className="min-w-0">
              <span className="font-medium text-ink">{member.name}</span>
              <span className="text-ink-secondary"> — {member.title}</span>
            </span>
          </li>
        ))}
      </ul>

      {connectFirst ? (
        <>
          <p className="animate-rise mt-4 text-center text-[13px] leading-relaxed text-ink-secondary" role="status" style={staggerIndex(2)}>
            {t("onboarding.team.unavailable")}
          </p>
          <div className="animate-rise mt-4 w-full" style={staggerIndex(3)}>
            <ConnectAI variant="embedded" onConnected={() => void build()} />
          </div>
        </>
      ) : (
        <PrimaryButton onClick={() => build()} disabled={status === "creating"} className="animate-rise mt-5" style={staggerIndex(2)}>
          {status === "creating"
            ? t("onboarding.team.creating")
            : status === "failed"
              ? t("onboarding.team.retry")
              : t("onboarding.team.action")}
        </PrimaryButton>
      )}

      {status === "failed" && (
        <div className="animate-rise mt-3 w-full rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-center text-[12.5px] text-danger" role="alert">
          <p>{t("onboarding.team.error")}</p>
          {error && <p className="mt-1 break-words text-[11.5px] opacity-80">{error}</p>}
        </div>
      )}

      {status === "unavailable" && (
        <QuietButton onClick={() => void build()} className="mt-3">
          {t("onboarding.team.retry")}
        </QuietButton>
      )}
      <QuietButton onClick={singleBot} disabled={status === "creating"} className="mt-3">
        {t("onboarding.team.single")}
      </QuietButton>
      <QuietButton onClick={continueWithoutTeam} disabled={status === "creating"} className="mt-2">
        {t("onboarding.team.continue")}
      </QuietButton>
    </div>
  );
}
