import { useState } from "react";
import { Check, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ROLE_LABEL } from "@/lib/person-roles";
import { matchPeople } from "@/state/people-directory";
import type { DirectoryPerson } from "../../../shared/people";
import { PersonAvatar } from "./PersonAvatar";

/** A searchable list of people. With `selected` it toggles several; without it each row picks one person. */
export function PeoplePicker({ people, selected, onSelect, label, empty, autoFocus = false, className }: {
  people: readonly DirectoryPerson[];
  selected?: readonly string[];
  onSelect: (person: DirectoryPerson) => void;
  label: string;
  empty?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = matchPeople(people, query);
  return (
    <div data-people-picker="" className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={label}
          aria-label={label}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-hairline/40 bg-inset py-2 pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-1 text-[12.5px] text-ink-secondary">{empty ?? t("people.picker.none")}</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {shown.map((person) => {
            const chosen = selected?.includes(person.email) ?? false;
            return (
              <li key={person.email}>
                <button
                  type="button"
                  data-person={person.email}
                  aria-pressed={selected ? chosen : undefined}
                  onClick={() => onSelect(person)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-ink/[0.06]", chosen && "bg-ink/[0.06]")}
                >
                  <PersonAvatar name={person.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{person.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-secondary">{person.email}</span>
                  </span>
                  {person.role === "guest" && <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-[10.5px] font-medium text-ink-secondary">{t(ROLE_LABEL.guest)}</span>}
                  {selected && <Check size={15} strokeWidth={2.5} aria-hidden="true" className={cn("shrink-0 text-accent-text", !chosen && "invisible")} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
