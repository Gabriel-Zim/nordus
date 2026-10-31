import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Check, Loader2, Plug } from "lucide-react";
import { t } from "@/lib/i18n";
import { detectSetupWithin, importOutcome, localSetupImport, setupImportApi, skillsSummary, toolsSummary } from "@/lib/setup-import";
import { detectionSources, type SetupDetection, type SetupImportResult } from "../../../../shared/setup-import";
import { GrokBotRow, ImportRow, RESULT_READ_MS } from "../beats/ImportBeat";
import { staggerIndex } from "../beats/shared";
import { Problem, Say, StepFooter, type StepProps } from "./chat-parts";

const importClient = () => (localSetupImport(false) ? setupImportApi : null);

function addedCount(result: SetupImportResult): number {
  return (result.skills?.added.length ?? 0) + (result.tools?.added.length ?? 0);
}

export function ImportStep({ onComplete, onSkip, onBusy }: StepProps) {
  const [client] = useState(importClient);
  const [detection, setDetection] = useState<SetupDetection | null>(null);
  const [looked, setLooked] = useState(client === null);
  const [chosen, setChosen] = useState({ skills: true, tools: true });
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [result, setResult] = useState<SetupImportResult | null>(null);
  const [grokOpen, setGrokOpen] = useState(false);
  const [grokAdded, setGrokAdded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const working = status === "working";
  const hasSkills = (detection?.skills.length ?? 0) > 0;
  const hasTools = (detection?.tools.length ?? 0) > 0;
  const wanted = (chosen.skills && hasSkills) || (chosen.tools && hasTools);
  const outcome = result ? importOutcome(result) : null;

  useEffect(() => {
    if (!client) return;
    const look = detectSetupWithin(client);
    let live = true;
    void look.found.then((found) => {
      if (!live) return;
      setDetection(found);
      setLooked(true);
    });
    return () => {
      live = false;
      look.cancel();
    };
  }, [client]);

  const finish = (brought: SetupImportResult | null) => {
    const count = (brought ? addedCount(brought) : 0) + (grokAdded ? 1 : 0);
    if (count > 0) onComplete({ outcome: "done", count });
    else onSkip();
  };

  const leave = useRef(() => {});
  leave.current = () => finish(result);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => leave.current(), RESULT_READ_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const bring = async () => {
    if (!client || working) return;
    setStatus("working");
    onBusy(true);
    try {
      const brought = await client.apply({ ...(chosen.skills && hasSkills ? { skills: true } : {}), ...(chosen.tools && hasTools ? { tools: true } : {}) });
      setResult(brought);
      setStatus("idle");
      if (!importOutcome(brought).notes.length) setLeaving(true);
    } catch {
      setStatus("failed");
    } finally {
      onBusy(false);
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (working || leaving) return;
    if (!result && wanted) void bring();
    else finish(result);
  };

  const message = !client ? t("onboarding.chat.import.askGrok") : looked && !detection ? t("onboarding.chat.import.nothing") : t("onboarding.chat.import.ask");
  const label = working ? t("onboarding.import.bringing") : !result && wanted ? t("onboarding.import.bring") : t("onboarding.chat.continue");

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Say state={result ? "proud" : "receiving"}>{message}</Say>
      <div className="animate-rise flex flex-col gap-3 sm:pl-[52px]" style={staggerIndex(1)}>
        {!looked && (
          <p className="flex items-center gap-2 text-[13px] text-ink-secondary" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t("onboarding.chat.import.looking")}
          </p>
        )}
        {outcome ? (
          <div className="flex items-start gap-3 rounded-xl border border-hairline/40 bg-card px-3.5 py-3" role="status">
            <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">{outcome.line}</p>
              {outcome.notes.map((note) => <p key={note} className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{note}</p>)}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-hairline/40 overflow-hidden rounded-xl border border-hairline/40 bg-card">
            {detection && hasSkills && (
              <ImportRow
                icon={<BookOpen size={15} />}
                label={t("onboarding.import.skills")}
                summary={skillsSummary(detection)}
                hint={t("onboarding.import.skillsHint")}
                sources={detectionSources(detection.skills)}
                checked={chosen.skills}
                disabled={working}
                onChange={(skills) => setChosen((now) => ({ ...now, skills }))}
              />
            )}
            {detection && hasTools && (
              <ImportRow
                icon={<Plug size={15} />}
                label={t("onboarding.import.tools")}
                summary={toolsSummary(detection)}
                hint={t("onboarding.import.toolsHint")}
                sources={detectionSources(detection.tools)}
                checked={chosen.tools}
                disabled={working}
                onChange={(tools) => setChosen((now) => ({ ...now, tools }))}
              />
            )}
            <GrokBotRow
              label={t("onboarding.import.grok")}
              open={grokOpen}
              disabled={working}
              onToggle={() => setGrokOpen((open) => !open)}
              onAdded={() => setGrokAdded(true)}
            />
          </div>
        )}
        {grokAdded && <p className="text-[12.5px] text-success" role="status">{t("onboarding.chat.import.grokAdded")}</p>}
        {status === "failed" && <Problem>{t("onboarding.import.error")}</Problem>}
        <StepFooter label={label} busy={working || leaving} onSkip={onSkip} />
      </div>
    </form>
  );
}
