import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import { sameEmail } from "@/lib/viewer";
import { startConversation, useDirect } from "@/state/direct-messages";
import { useDirectory } from "@/state/people-directory";
import { useStore } from "@/state/store";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import type { DirectConversation } from "../../../shared/people";
import { PeoplePicker } from "./PeoplePicker";
import { PersonAvatar } from "./PersonAvatar";

/** Conversations with something said in them, plus the one that is open. */
export function listedConversations(dms: readonly DirectConversation[], activeId: string | null): DirectConversation[] {
  return dms.filter((dm) => dm.last || dm.id === activeId);
}

export function DirectRows({ dms, activeId, density, selfEmail, onOpen }: {
  dms: readonly DirectConversation[];
  activeId: string | null;
  density: SidebarDensity;
  selfEmail: string | undefined;
  onOpen: (dm: DirectConversation) => void;
}) {
  return (
    <>
      {dms.map((dm) => {
        const active = dm.id === activeId;
        const unread = dm.unread && !active;
        return (
          <button
            key={dm.id}
            type="button"
            data-sidebar-dm-row={dm.id}
            data-preload="direct"
            aria-current={active ? "page" : undefined}
            onClick={() => onOpen(dm)}
            className={cn(
              "relative flex w-full items-center rounded-xl text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent/60",
              density === "compact" ? "gap-2.5 py-1.5 pl-2 pr-3" : "gap-3 py-2 pl-2.5 pr-3",
              active ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <PersonAvatar name={dm.peerName} size={density === "compact" ? 32 : 40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("nb-name truncate text-[15px] text-ink", unread && "font-semibold")}>{dm.peerName}</span>
                {unread && <span role="img" aria-label={t("dm.unread")} className="size-2 shrink-0 rounded-full bg-unread" />}
              </div>
              {dm.last && (
                <div className="truncate text-[12px] leading-[16px] text-ink-tertiary">
                  {sameEmail(dm.last.from, selfEmail) ? `${t("dm.you")}: ` : ""}{dm.last.text}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </>
  );
}

/** The sidebar's "Direct messages": people to write to, one to one. It stays out of sight when there is nobody to write to. */
export function DirectMessagesBlock({ density }: { density: SidebarDensity }) {
  const { state, dispatch } = useStore();
  const viewer = useViewer();
  const direct = useDirect();
  const [picking, setPicking] = useState(false);
  const { people } = useDirectory({ fresh: picking });
  const [failed, setFailed] = useState(false);
  if (!direct.available || density === "icons") return null;

  const activeId = state.activeView === "direct" ? state.directId ?? null : null;
  const rows = listedConversations(direct.dms, activeId);
  const others = people.filter((person) => !sameEmail(person.email, viewer.email));
  if (others.length === 0 && rows.length === 0) return null;

  const open = (id: string) => dispatch({ type: "showDirect", id });
  const start = async (email: string) => {
    setFailed(false);
    try {
      const dm = await startConversation(email);
      setPicking(false);
      open(dm.id);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div data-sidebar-direct="" className="flex flex-col gap-0.5 pt-3">
      <div className="flex items-center gap-2 pb-1.5 pl-1.5 pr-0.5 pt-1">
        <span className="min-w-0 shrink truncate px-0.5 text-[11.5px] font-medium tracking-[0.01em] text-ink-tertiary">{t("dm.section")}</span>
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-hairline/60" />
        {others.length > 0 && (
          <button
            type="button"
            data-direct-new=""
            aria-expanded={picking}
            aria-label={t("dm.new")}
            title={t("dm.new")}
            onClick={() => { setPicking((on) => !on); setFailed(false); }}
            className="flex h-[18px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {picking && (
        <div data-direct-picker="" className="mx-1 mb-1 rounded-xl border border-hairline/40 bg-inset/50 p-2">
          <PeoplePicker people={others} label={t("dm.search")} autoFocus onSelect={(person) => void start(person.email)} />
          {failed && <p role="alert" className="mt-1.5 px-1 text-[12px] text-danger">{t("dm.startFailed")}</p>}
        </div>
      )}
      <DirectRows dms={rows} activeId={activeId} density={density} selfEmail={viewer.email} onOpen={(dm) => open(dm.id)} />
    </div>
  );
}
