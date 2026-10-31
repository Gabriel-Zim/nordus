import { activeLocale, t } from "@/lib/i18n";
import type { ChatProgress } from "@/lib/onboarding-chat";
import { useStore } from "@/state/store";
import { PrimaryButton, staggerIndex } from "../beats/shared";
import { Say } from "./chat-parts";

function names(list: readonly string[]): string {
  return new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(list);
}

export function summaryLines(progress: ChatProgress): string[] {
  const lines: string[] = [];
  const company = progress.company;
  if (company?.outcome === "done" && company.value) lines.push(t("onboarding.chat.done.company", { name: company.value }));
  if (progress.about?.outcome === "done") lines.push(t("onboarding.chat.done.context"));
  const agents = progress.agents;
  if (agents?.outcome === "done" && agents.names?.length) {
    const key = agents.names.length === 1 ? "onboarding.chat.done.agentsOne" : "onboarding.chat.done.agents";
    lines.push(t(key, { count: agents.names.length, names: names(agents.names) }));
  }
  const tools = progress.tools;
  if (tools?.outcome === "done" && tools.names?.length) lines.push(t("onboarding.chat.done.tools", { names: names(tools.names) }));
  return lines;
}

export function DoneStep({ progress, finishing, onFinish }: { progress: ChatProgress; finishing: boolean; onFinish: (select?: string) => void }) {
  const { state } = useStore();
  const general = (state.groups ?? []).find((group) => group.general && !group.dm);
  const created = progress.agents?.names ?? [];
  const first = (state.bots ?? []).find((bot) => !bot.hidden && created.includes(bot.name));
  const target = general?.id ?? first?.id;
  const lines = summaryLines(progress);
  return (
    <div className="flex flex-col gap-4">
      <Say state="celebrate">{t("onboarding.chat.done.say")}</Say>
      <div className="animate-rise flex flex-col gap-4 sm:pl-[52px]" style={staggerIndex(1)}>
        {lines.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-xl border border-hairline/40 bg-card px-4 py-3 text-[13.5px] text-ink">
            {lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
        <PrimaryButton type="button" onClick={() => onFinish(target)} disabled={finishing} className="sm:w-auto sm:self-start sm:px-6">
          {general ? t("onboarding.chat.done.openGeneral") : first ? t("onboarding.chat.done.start") : t("onboarding.chat.done.close")}
          <span aria-hidden="true" className="ml-2 opacity-70">↵</span>
        </PrimaryButton>
      </div>
    </div>
  );
}
