import { useState } from "react";
import { Plus, UsersRound, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ROLE_LABEL } from "@/lib/person-roles";
import { canRemoveFromRoom, peopleForLimitedRoom, peopleToAdd, roomPeopleView, withPerson, withoutPerson } from "@/lib/room-people";
import { useViewer } from "@/lib/use-viewer";
import { sameEmail } from "@/lib/viewer";
import { api } from "@/state/api";
import { personNamed, useDirectory } from "@/state/people-directory";
import { useStore, type Group } from "@/state/store";
import type { DirectoryPerson } from "../../../shared/people";
import { PeoplePicker } from "./PeoplePicker";
import { PersonAvatar } from "./PersonAvatar";

const caps = "text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary";
const card = "rounded-[14px] border border-white/[0.07] bg-white/[0.03]";
const quiet = "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50";

export function RoomPeople({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const viewer = useViewer();
  const { people: directory } = useDirectory({ fresh: true });
  const view = roomPeopleView(group, viewer);
  const [mode, setMode] = useState<"idle" | "adding" | "limiting">("idle");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (people: string[] | null) => {
    setBusy(true);
    setError(null);
    try {
      const { group: next } = await api<{ group: Group }>(`/api/people/rooms/${encodeURIComponent(group.id)}/people`, { method: "PUT", body: JSON.stringify({ people }) });
      dispatch({ type: "groupPatched", group: next });
      setMode("idle");
      setChosen([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleChosen = (person: DirectoryPerson) => setChosen((current) => (current.includes(person.email) ? withoutPerson(current, person.email) : withPerson(current, person.email)));
  const limited = peopleForLimitedRoom(chosen, group.createdBy ?? viewer.email);
  const candidates = peopleToAdd(directory, group);

  return (
    <section className="flex flex-col gap-2" data-room-info-section="people">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className={caps}>{t("channels.people.title")}</h3>
        {view.canEdit && !view.everyone && mode === "idle" && candidates.length > 0 && (
          <button type="button" data-room-add-person="" disabled={busy} onClick={() => setMode("adding")} className={quiet}>
            <Plus size={13} aria-hidden="true" />
            {t("channels.people.add")}
          </button>
        )}
      </div>

      {view.everyone ? (
        <div className={cn(card, "flex items-center gap-3 px-3.5 py-3")}>
          <UsersRound size={18} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] text-ink">{t("channels.people.everyone")}</div>
            <div className="text-[12px] leading-relaxed text-ink-secondary">{t(view.general ? "channels.people.generalHint" : "channels.people.everyoneHint")}</div>
          </div>
        </div>
      ) : (
        <>
          <ul className={cn(card, "divide-y divide-hairline/40")}>
            {view.emails.map((email) => {
              const known = directory.find((person) => person.email === email);
              const name = personNamed(directory, email);
              return (
                <li key={email} data-room-person={email} className="group/person flex items-center gap-3 px-3 py-2">
                  <PersonAvatar name={name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13.5px] text-ink">{name}</span>
                      {sameEmail(email, viewer.email) && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("channels.people.you")}</span>}
                      {known?.role === "guest" && <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-[10.5px] font-medium text-ink-secondary">{t(ROLE_LABEL.guest)}</span>}
                    </div>
                    <div className="truncate text-[12px] text-ink-secondary">{email}</div>
                  </div>
                  {view.canEdit && canRemoveFromRoom(group, email) && (
                    <button
                      type="button"
                      data-room-remove-person={email}
                      disabled={busy}
                      onClick={() => void save(withoutPerson(view.emails, email))}
                      aria-label={t("channels.people.remove", { name })}
                      title={t("channels.people.remove", { name })}
                      className="rounded-md p-1 text-ink-tertiary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/person:opacity-100 touch:opacity-100"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="px-1 text-[12px] leading-relaxed text-ink-secondary">{t("channels.people.limitedHint")}</p>
        </>
      )}

      {view.canEdit && view.everyone && mode === "idle" && (
        <button type="button" data-room-limit="" disabled={busy} onClick={() => setMode("limiting")} className={cn(quiet, "self-start")}>
          {t("channels.people.limit")}
        </button>
      )}
      {view.canEdit && !view.everyone && mode === "idle" && (
        <button type="button" data-room-open-to-all="" disabled={busy} onClick={() => void save(null)} className={cn(quiet, "self-start")}>
          {t("channels.people.openToAll")}
        </button>
      )}

      {mode === "adding" && (
        <div className={cn(card, "p-2.5")}>
          <PeoplePicker
            people={candidates}
            label={t("channels.people.addLabel")}
            empty={t("channels.people.noneLeft")}
            autoFocus
            onSelect={(person) => void save(withPerson(view.emails, person.email))}
          />
          <button type="button" disabled={busy} onClick={() => setMode("idle")} className={cn(quiet, "mt-2")}>{t("common.cancel")}</button>
        </div>
      )}

      {mode === "limiting" && (
        <div className={cn(card, "p-2.5")}>
          <p className="mb-2 px-1 text-[12.5px] text-ink-secondary">{t("channels.people.pick")}</p>
          <PeoplePicker people={directory} selected={chosen} label={t("channels.people.addLabel")} autoFocus onSelect={toggleChosen} />
          {chosen.length === 0 && <p className="mt-2 px-1 text-[12px] text-ink-secondary">{t("channels.people.onlyYou")}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button type="button" data-room-limit-save="" disabled={busy || !limited} onClick={() => limited && void save(limited)} className="ui-button ui-button-primary ui-button-sm">{t("common.save")}</button>
            <button type="button" disabled={busy} onClick={() => { setMode("idle"); setChosen([]); }} className={quiet}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="px-1 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
