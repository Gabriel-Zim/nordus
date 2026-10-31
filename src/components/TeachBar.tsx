import { useState } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { teachStepLabel, type TeachStatus } from "../../shared/teach";

/** Above the text box while the robot's browser is being watched: a red dot, "Gravando", the stop button and a closed list of steps. */
export function TeachBar({
  status,
  botId,
  advanced,
  onStop,
}: {
  status: TeachStatus;
  botId: string;
  advanced: boolean;
  onStop: () => void;
}) {
  const summarizing = !status.recording && status.state === "summarizing";
  if (!status.recording && !summarizing) return null;
  const count = status.steps.length;
  return (
    <div
      data-teach-bar=""
      role="status"
      className="mb-2 w-full rounded-xl border border-hairline/30 bg-raised/80 px-3 py-2 text-[13px] text-ink backdrop-blur"
    >
      <div className="flex items-center gap-2">
        {summarizing ? (
          <>
            <Loader2 size={14} className="shrink-0 animate-spin text-ink-secondary" aria-hidden="true" />
            <span data-teach-summarizing="" className="min-w-0 flex-1 truncate text-ink-secondary">{t("teach.summarizing")}</span>
          </>
        ) : (
          <>
            <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger/60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
            </span>
            <span data-teach-recording="" className="min-w-0 flex-1 truncate font-medium">
              {t("teach.recording")}
              {advanced && count > 0 && (
                <span className="ml-2 font-normal text-ink-secondary">{t("teach.stepCount", { count })}</span>
              )}
            </span>
            <button
              type="button"
              data-teach-stop=""
              onClick={onStop}
              className="shrink-0 rounded-full border border-hairline/30 px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-control"
            >
              {t("teach.stop")}
            </button>
          </>
        )}
      </div>
      {!summarizing && <TeachSteps status={status} botId={botId} />}
    </div>
  );
}

function TeachSteps({ status, botId }: { status: TeachStatus; botId: string }) {
  return (
    <details data-teach-steps="" className="mt-1.5 text-ink-secondary">
      <summary className="cursor-pointer select-none text-[12.5px] hover:text-ink">{t("teach.steps")}</summary>
      {status.steps.length === 0 ? (
        <p className="mt-1.5 text-[12.5px]">{t("teach.noSteps")}</p>
      ) : (
        <ol className="mt-1.5 max-h-48 space-y-1 overflow-y-auto pr-1">
          {status.steps.map((step) => (
            <li key={step.n} className="flex items-center gap-2 text-[12.5px]">
              {step.shot && <StepShot botId={botId} n={step.n} />}
              <span className="shrink-0 tabular-nums text-ink-tertiary">{step.n}.</span>
              <span className={cn("min-w-0 flex-1 truncate", step.critical && "text-warning")}>{teachStepLabel(step)}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** The thumbnail is optional: when the server has none for a step, the row stays text only. */
function StepShot({ botId, n }: { botId: string; n: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={`/api/bots/${botId}/teach/shot/${n}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-8 w-12 shrink-0 rounded border border-hairline/30 object-cover"
    />
  );
}
