import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { newRoomPeople, withPerson, withoutPerson, type NewRoomPeople } from "@/lib/room-people";
import { useViewer } from "@/lib/use-viewer";
import { sameEmail } from "@/lib/viewer";
import { useDirectory } from "@/state/people-directory";
import type { DirectoryPerson } from "../../../shared/people";
import { PeoplePicker } from "./PeoplePicker";

const choice = (on: boolean) => cn("rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors", on ? "bg-accent/15 text-accent" : "bg-raised/70 text-ink-secondary hover:text-ink");

/** "Who is in" for a new channel. Nothing shows while the workspace has nobody else to choose. */
export function NewRoomWho({ onChange }: { onChange: (next: NewRoomPeople) => void }) {
  const viewer = useViewer();
  const { people } = useDirectory({ fresh: true });
  const [limited, setLimited] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const others = people.filter((person) => !sameEmail(person.email, viewer.email));
  if (others.length === 0) return null;

  const update = (nextLimited: boolean, nextPicked: string[]) => {
    setLimited(nextLimited);
    setPicked(nextPicked);
    onChange(newRoomPeople(nextLimited, nextPicked, viewer.email));
  };
  const toggle = (person: DirectoryPerson) => update(true, picked.includes(person.email) ? withoutPerson(picked, person.email) : withPerson(picked, person.email));

  return (
    <div data-new-room-who="" className="mt-3">
      <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{t("channels.new.who")}</div>
      <div role="group" aria-label={t("channels.new.who")} className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!limited} onClick={() => update(false, picked)} className={choice(!limited)}>{t("channels.people.everyone")}</button>
        <button type="button" aria-pressed={limited} onClick={() => update(true, picked)} className={choice(limited)}>{t("channels.new.some")}</button>
      </div>
      {limited && (
        <div className="mt-2">
          <PeoplePicker people={others} selected={picked} onSelect={toggle} label={t("channels.new.search")} />
          {picked.length === 0 && <p className="mt-1.5 px-1 text-[12px] text-ink-secondary">{t("channels.people.onlyYou")}</p>}
        </div>
      )}
      <p className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-ink-secondary">{t("channels.new.later")}</p>
    </div>
  );
}
