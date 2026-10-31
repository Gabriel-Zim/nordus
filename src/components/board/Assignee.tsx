import { User } from "lucide-react";
import { senderInitials } from "@/lib/message-author";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { BoardAssignee, BoardPerson } from "../../../shared/board";
import { assigneeKind } from "../../../shared/board";
import type { Directory } from "@/lib/board";
import { BotAvatar, InitialsAvatar } from "../Avatar";
import { Select } from "../Select";

const NONE = "";

export function AssigneeAvatar({ assignee, directory, size = 22 }: { assignee?: BoardAssignee; directory: Directory; size?: number }) {
  if (!assignee) {
    return (
      <span role="img" aria-label={t("board.assignee.none")} title={t("board.assignee.none")} data-assignee="" style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-full border border-dashed border-hairline text-ink-tertiary">
        <User size={Math.round(size * 0.55)} aria-hidden="true" />
      </span>
    );
  }
  const name = directory.assigneeName(assignee);
  const bot = assigneeKind(assignee) === "bot" ? directory.bot(assignee) : undefined;
  return (
    <span role="img" aria-label={name} title={name} data-assignee={assignee} className="flex shrink-0">
      {bot ? <BotAvatar bot={bot} size={size} label={name} /> : <InitialsAvatar initials={senderInitials(name)} size={size} />}
    </span>
  );
}

export function AssigneeSelect({ value, onChange, directory, bots, people, label, disabled, size = "md" }: {
  value?: BoardAssignee;
  onChange: (assignee: BoardAssignee | null) => void;
  directory: Directory;
  bots: readonly Bot[];
  people: readonly BoardPerson[];
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const listed = (value ?? NONE) === NONE || bots.some((bot) => bot.id === value) || people.some((person) => person.id === value);
  return (
    <Select size={size} aria-label={label} disabled={disabled} className="w-full" value={value ?? NONE}
      onChange={(event) => onChange(event.target.value === NONE ? null : event.target.value)}>
      <option value={NONE}>{t("board.assignee.none")}</option>
      {!listed && <option value={value}>{directory.assigneeName(value!)}</option>}
      {bots.length > 0 && (
        <optgroup label={t("board.assignee.agents")}>
          {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </optgroup>
      )}
      {people.length > 0 && (
        <optgroup label={t("board.assignee.people")}>
          {people.map((person) => <option key={person.id} value={person.id}>{directory.assigneeName(person.id)}</option>)}
        </optgroup>
      )}
    </Select>
  );
}
