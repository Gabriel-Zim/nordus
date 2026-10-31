import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { ModelPicker } from "./ModelPicker";

/**
 * The provider's "selected model" refusal as one plain sentence, plus the ways out: choose another model (the same
 * picker as the profile, opened here inline) or retry the turn when the conversation can.
 */
export function ModelUnavailableCard({ botId, threadId, onRetry }: {
  botId?: string;
  threadId?: string;
  onRetry?: () => void;
}) {
  const { state } = useStore();
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
  const [choosing, setChoosing] = useState(false);
  const buttonClass = "ui-button ui-button-md rounded-full border-danger/30 bg-transparent text-danger hover:bg-danger/15";
  return (
    <div className="flex justify-start">
      <div className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-[13.5px] text-danger">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{t("error.plain.modelUnavailable")}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {bot && (
            <button type="button" aria-expanded={choosing} onClick={() => setChoosing((open) => !open)} className={buttonClass}>
              {t("chat.error.chooseOtherModel")}
            </button>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} className={buttonClass}>
              <RefreshCw size={12} /> {t("chat.retry")}
            </button>
          )}
        </div>
        {bot && choosing && (
          <div className="mt-2 min-w-[260px] text-ink">
            <ModelPicker bot={bot} threadId={threadId} contained />
          </div>
        )}
      </div>
    </div>
  );
}
