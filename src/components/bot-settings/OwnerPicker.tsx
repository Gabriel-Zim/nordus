import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { ownerChoices, ownerPatch, ownerRowMode, ownerValue, type OwnerChoice } from "@/lib/bot-owner";
import { t } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import { api } from "@/state/api";
import { useDirectory } from "@/state/people-directory";
import { useStore, type Bot, type BotAnnouncement } from "@/state/store";
import { Select } from "../Select";

export function useOwnerRow(bot: Pick<Bot, "owner">) {
  const viewer = useViewer();
  const { people } = useDirectory();
  const choices = ownerChoices(people, bot.owner);
  return { people, choices, mode: ownerRowMode(viewer, choices, bot.owner) };
}

/** Who answers for an agent: the administrators, or one person on the team. Only an admin gets to change it. */
export function OwnerPicker({ bot, choices }: { bot: Pick<Bot, "id" | "name" | "owner">; choices: readonly OwnerChoice[] }) {
  const { dispatch } = useStore();
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (value: string) => {
    setPending(value);
    setSaved(false);
    setError(null);
    try {
      const { bot: next } = await api<{ bot: BotAnnouncement }>(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(ownerPatch(value)) });
      dispatch({ type: "botPatched", bot: next });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <div data-bot-owner="" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Select
          size="sm"
          className="min-w-0 flex-1"
          value={pending ?? ownerValue(bot.owner)}
          disabled={pending !== null}
          onChange={(event) => void change(event.target.value)}
          aria-label={t("people.owner.label", { name: bot.name })}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value} data-description={choice.email}>{choice.name ?? t("people.owner.admins")}</option>
          ))}
        </Select>
        {pending !== null && <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin text-ink-secondary" />}
        {saved && pending === null && !error && (
          <span role="status" className="flex shrink-0 items-center gap-1 text-[12px] text-success"><Check size={13} aria-hidden="true" />{t("people.owner.saved")}</span>
        )}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/** The picker as a card of its own, for the settings list that has no rows. Nothing shows to whoever may not change it. */
export function OwnerCard({ bot }: { bot: Bot }) {
  const { choices, mode } = useOwnerRow(bot);
  if (mode !== "edit") return null;
  return (
    <div data-bot-owner-card="" className="flex flex-col gap-2 rounded-xl border border-hairline/40 bg-card p-4">
      <div>
        <div className="text-[13.5px] font-semibold text-ink">{t("people.owner.title")}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{t("people.owner.hint")}</p>
      </div>
      <OwnerPicker bot={bot} choices={choices} />
    </div>
  );
}
