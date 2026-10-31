import { useState } from "react";
import { Link2, Plug, Plus, Sparkles, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { useAdvancedMode } from "@/lib/interface-mode";
import { COMPOSE_TEXT_EVENT } from "@/lib/native-app";
import { ConnectAI } from "./ConnectAI";

export const CONFIG_CHIP_IDS = ["connect-ai", "connect-apps", "create-assistant", "what-can-you-do"] as const;
export const IDEA_CHIP_IDS = ["help-write", "plan-week"] as const;
export type StarterChipId = (typeof CONFIG_CHIP_IDS)[number] | (typeof IDEA_CHIP_IDS)[number];

const CHIP_LABEL = {
  "connect-ai": "chat.start.connectAi",
  "connect-apps": "chat.start.connectApps",
  "create-assistant": "chat.start.createAssistant",
  "what-can-you-do": "chat.start.whatCanYouDo",
  "help-write": "chat.start.helpWrite",
  "plan-week": "chat.start.planWeek",
} as const satisfies Record<StarterChipId, LocaleKey>;

/** Configuration first while the person still has a single bot or no routine; never more than six. */
export function starterChipOrder(configFirst: boolean): StarterChipId[] {
  return [...(configFirst ? CONFIG_CHIP_IDS : IDEA_CHIP_IDS), ...(configFirst ? IDEA_CHIP_IDS : CONFIG_CHIP_IDS)];
}

function compose(text: string, send = false): void {
  window.dispatchEvent(new CustomEvent(COMPOSE_TEXT_EVENT, { detail: { text } }));
  if (!send) return;
  window.setTimeout(() => document.querySelector<HTMLButtonElement>("[data-composer-send]")?.click(), 0);
}

export function runStarterChip(id: StarterChipId, { dispatch, openConnect }: {
  dispatch: (action: { type: "togglePlugins"; open: boolean }) => void;
  openConnect: () => void;
}): void {
  if (id === "connect-ai") return openConnect();
  if (id === "connect-apps") return dispatch({ type: "togglePlugins", open: true });
  if (id === "create-assistant") return compose(`${t("chat.start.assistantPrefix")} `);
  if (id === "what-can-you-do") return compose(t("chat.start.whatCanYouDo"), true);
  compose(t(CHIP_LABEL[id]));
}

const ICON: Record<StarterChipId, typeof Plus> = {
  "connect-ai": Plus,
  "connect-apps": Plug,
  "create-assistant": Sparkles,
  "what-can-you-do": Link2,
  "help-write": Sparkles,
  "plan-week": Sparkles,
};

/** `setupOnly` drops the generic ideas when another block already offers concrete starting requests. */
export function StarterChips({ setupOnly = false }: { setupOnly?: boolean }) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const [connectOpen, setConnectOpen] = useState(false);
  if (advanced) return null;
  const configFirst = state.bots.length <= 1 || state.routines.length === 0;
  const chips = setupOnly ? CONFIG_CHIP_IDS : starterChipOrder(configFirst).slice(0, 6);
  const openConnect = () => setConnectOpen(true);
  return (
    <>
      <div
        data-starter-chips=""
        data-starter-chips-setup-only={setupOnly ? "" : undefined}
        className={`flex max-w-[560px] flex-wrap justify-center gap-2${setupOnly ? " mt-5" : ""}`}
      >
        {chips.map((id) => {
          const Icon = ICON[id];
          return (
            <button
              key={id}
              type="button"
              data-starter-chip={id}
              onClick={() => runStarterChip(id, { dispatch, openConnect })}
              className="flex items-center gap-1.5 rounded-full border border-hairline/50 bg-raised/60 px-3 py-1.5 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
            >
              <Icon size={13} aria-hidden="true" />
              {t(CHIP_LABEL[id])}
            </button>
          );
        })}
      </div>
      {connectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConnectOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={t("chat.start.connectAiTitle")} className="relative max-h-[85vh] w-full max-w-[520px] overflow-auto rounded-2xl border border-hairline/40 bg-card p-5 shadow-2xl">
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => setConnectOpen(false)}
              className="absolute right-3 top-3 rounded-md p-1 text-ink-tertiary hover:bg-raised hover:text-ink"
            >
              <X size={16} />
            </button>
            <ConnectAI variant="embedded" onConnected={() => setConnectOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
