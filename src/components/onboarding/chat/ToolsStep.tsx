import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { pollConnector } from "@/lib/connector-poll";
import { hasActiveConnection, type ConnectorStatus } from "@/lib/connector-status";
import { t } from "@/lib/i18n";
import { mcpSignInLink } from "@/lib/mcp-sign-in";
import { suggestedTools } from "@/lib/onboarding-chat";
import { api } from "@/state/store";
import { preloadConnectedApps, ServiceIcon, type ToolkitCard } from "../../connected-apps";
import { staggerIndex } from "../beats/shared";
import { Problem, Say, StepFooter, type StepProps } from "./chat-parts";

type Phase = "loading" | "ready" | "unavailable" | "failed";

interface CatalogReply {
  configured?: boolean;
  cards?: ToolkitCard[];
}

export function ToolsStep({ progress, onComplete, onSkip }: StepProps) {
  const text = `${progress.company?.value ?? ""} ${progress.about?.value ?? ""}`;
  const [phase, setPhase] = useState<Phase>("loading");
  const [cards, setCards] = useState<ToolkitCard[]>([]);
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const opening = useRef<ReturnType<typeof reserveConnectionPage> | null>(null);
  const polls = useRef(new Map<string, () => void>());

  useEffect(() => {
    let live = true;
    const pending = polls.current;
    void Promise.all([api<CatalogReply>("/api/connectors/catalog"), preloadConnectedApps()]).then(
      ([catalog, inventory]) => {
        if (!live) return;
        setStatus(inventory.services);
        if (!catalog.configured) {
          setPhase("unavailable");
          return;
        }
        setCards(suggestedTools((catalog.cards ?? []).filter((card) => !card.noAuth), text));
        setPhase("ready");
      },
      () => {
        if (live) setPhase("failed");
      },
    );
    return () => {
      live = false;
      opening.current?.cancel();
      opening.current = null;
      for (const stop of pending.values()) stop();
      pending.clear();
    };
  }, [text]);

  const read = async (slug: string): Promise<ConnectorStatus | undefined> => {
    const reply = await api<{ services?: Record<string, ConnectorStatus> }>(`/api/connectors?services=${slug}`).catch(() => undefined);
    const state = reply?.services?.[slug];
    if (state) setStatus((current) => ({ ...current, [slug]: state }));
    return state;
  };

  const connect = async (card: ToolkitCard) => {
    if (busy || opening.current) return;
    const launch = reserveConnectionPage();
    opening.current = launch;
    setBusy(card.slug);
    setProblem(false);
    try {
      const before = status[card.slug];
      const reply = await api<{ url?: unknown }>(`/api/connectors/${card.slug}/authorize`, { method: "POST" });
      if (opening.current !== launch) return;
      const url = mcpSignInLink(typeof reply.url === "string" ? reply.url : null);
      if (!url) throw new Error("The sign-in link is not usable");
      setStatus((current) => ({
        ...current,
        [card.slug]: { ...current[card.slug], connected: current[card.slug]?.connected ?? false, pending: true, status: "INITIATED" },
      }));
      polls.current.get(card.slug)?.();
      const stop = pollConnector(before, () => read(card.slug), () => {
        polls.current.delete(card.slug);
        void read(card.slug);
      });
      polls.current.set(card.slug, stop);
      if (!(await launch.open(url)) && opening.current === launch) setProblem(true);
    } catch {
      if (opening.current === launch) setProblem(true);
    } finally {
      launch.cancel();
      if (opening.current === launch) {
        opening.current = null;
        setBusy(null);
      }
    }
  };

  const connected = cards.filter((card) => hasActiveConnection(status[card.slug]));

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onComplete({ outcome: "done", names: connected.map((card) => card.label) });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Say state="sending">{t("onboarding.chat.tools.ask")}</Say>
      <div className="animate-rise flex flex-col gap-3 sm:pl-[52px]" style={staggerIndex(1)}>
        {phase === "loading" && (
          <p className="flex items-center gap-2 text-[13px] text-ink-secondary" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t("onboarding.chat.tools.loading")}
          </p>
        )}
        {phase === "unavailable" && <p className="text-[13px] leading-relaxed text-ink-secondary" role="status">{t("onboarding.chat.tools.unavailable")}</p>}
        {phase === "failed" && <Problem>{t("onboarding.chat.tools.loadError")}</Problem>}
        {phase === "ready" && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cards.map((card) => {
              const state = status[card.slug];
              const done = hasActiveConnection(state);
              const waiting = state?.pending === true || busy === card.slug;
              return (
                <li key={card.slug} className="flex items-center gap-3 rounded-xl border border-hairline/40 bg-card px-3 py-2.5">
                  <ServiceIcon card={card} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{card.label}</p>
                    <p className="truncate text-[11.5px] text-ink-secondary">{card.blurb}</p>
                  </div>
                  {done ? (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-success">
                      <Check size={13} aria-hidden="true" />
                      {t("onboarding.chat.tools.connected")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void connect(card)}
                      disabled={Boolean(busy) || waiting}
                      className="shrink-0 rounded-lg border border-hairline/50 px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-raised disabled:opacity-50"
                    >
                      {waiting ? t("onboarding.chat.tools.waiting") : t("onboarding.chat.tools.connect")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {problem && <Problem>{t("onboarding.chat.tools.error")}</Problem>}
        {phase === "ready" && <p className="text-[12px] text-ink-secondary">{t("onboarding.chat.tools.more")}</p>}
        <StepFooter label={t("onboarding.chat.continue")} onSkip={onSkip} />
      </div>
    </form>
  );
}
