import { useState, type FormEvent } from "react";
import { ConnectAI } from "@/components/ConnectAI";
import { engineReady } from "@/components/EngineLibrary";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  AGENT_NAME_MAX,
  AGENT_TITLE_MAX,
  chosenAgents,
  proposeTeam,
  type AgentProposal,
} from "@/lib/onboarding-chat";
import { createChosenTeam } from "@/lib/onboarding-chat-actions";
import { StarterTeamBuildError, StarterTeamUnavailableError } from "@/lib/starter-team";
import { api, useStore } from "@/state/store";
import { QuietButton, staggerIndex } from "../beats/shared";
import { Problem, Say, StepFooter, textFieldClass, type StepProps } from "./chat-parts";

type Status = "idle" | "creating" | "unavailable" | "failed";

export function AgentsStep({ progress, onComplete, onSkip, onBusy }: StepProps) {
  const { state, dispatch } = useStore();
  const company = progress.company?.value ?? state.config?.profile?.company ?? "";
  const [rows, setRows] = useState<AgentProposal[]>(() => proposeTeam({ company, about: progress.about?.value ?? "" }));
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const instances = state.instances ?? [];
  const connectFirst = status === "unavailable" || (!connected && instances.length > 0 && !instances.some(engineReady));
  const creating = status === "creating";
  const picked = chosenAgents(rows);
  const createLabel = creating
    ? t("onboarding.team.creating")
    : status === "failed"
      ? t("onboarding.team.retry")
      : picked.length === 1
        ? t("onboarding.chat.agents.createOne")
        : picked.length > 1
          ? t("onboarding.chat.agents.create", { count: picked.length })
          : t("onboarding.chat.continue");

  const edit = (id: AgentProposal["id"], patch: Partial<AgentProposal>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const build = async () => {
    if (creating) return;
    setStatus("creating");
    setMessage("");
    onBusy(true);
    try {
      const { bots } = await createChosenTeam(api, state.bots ?? [], rows);
      for (const bot of bots) dispatch({ type: "botAdded", bot, preserveSelection: true });
      onComplete({ outcome: "done", count: bots.length, names: bots.map((bot) => bot.name) });
    } catch (cause) {
      if (cause instanceof StarterTeamUnavailableError) {
        setStatus("unavailable");
        return;
      }
      setStatus("failed");
      if (cause instanceof StarterTeamBuildError) {
        for (const bot of cause.confirmedBots) dispatch({ type: "botAdded", bot, preserveSelection: true });
        setMessage(cause.message);
      }
    } finally {
      onBusy(false);
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (creating || connectFirst) return;
    if (!picked.length) onSkip();
    else void build();
  };

  if (connectFirst) {
    return (
      <div className="flex flex-col gap-4">
        <Say state="working">{t("onboarding.chat.agents.askConnect")}</Say>
        <div className="animate-rise flex flex-col gap-3 sm:pl-[52px]" style={staggerIndex(1)}>
          <ConnectAI variant="embedded" onConnected={() => { setConnected(true); setStatus("idle"); }} />
          <div className="mt-3">
            <QuietButton type="button" onClick={onSkip}>{t("onboarding.chat.skip")}</QuietButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Say state="working">{t("onboarding.chat.agents.ask")}</Say>
      <div className="animate-rise flex flex-col gap-3 sm:pl-[52px]" style={staggerIndex(1)}>
        <ul className="flex max-h-[min(22rem,calc(100dvh-21rem))] flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn("flex items-start gap-3 rounded-xl border border-hairline/40 bg-card px-3.5 py-3 transition-opacity", !row.checked && "opacity-55")}
            >
              <input
                type="checkbox"
                checked={row.checked}
                disabled={creating}
                onChange={(event) => edit(row.id, { checked: event.target.checked })}
                aria-label={t("onboarding.chat.agents.include", { name: row.name })}
                className="mt-2.5 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <input
                    value={row.name}
                    onChange={(event) => edit(row.id, { name: event.target.value })}
                    maxLength={AGENT_NAME_MAX}
                    disabled={creating}
                    aria-label={t("onboarding.chat.agents.name")}
                    className={cn(textFieldClass, "py-1.5 text-[14px] sm:w-[38%]")}
                  />
                  <input
                    value={row.title}
                    onChange={(event) => edit(row.id, { title: event.target.value })}
                    maxLength={AGENT_TITLE_MAX}
                    disabled={creating}
                    aria-label={t("onboarding.chat.agents.role")}
                    className={cn(textFieldClass, "py-1.5 text-[14px] sm:flex-1")}
                  />
                </div>
                <p className="text-[12px] leading-relaxed text-ink-secondary">{row.description}</p>
              </div>
            </li>
          ))}
        </ul>
        {status === "failed" && (
          <Problem>
            {t("onboarding.team.error")}
            {message && <span className="mt-1 block break-words text-[11.5px] opacity-80">{message}</span>}
          </Problem>
        )}
        <StepFooter label={createLabel} busy={creating} onSkip={onSkip} />
      </div>
    </form>
  );
}
