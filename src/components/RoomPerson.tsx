import type { ReactNode } from "react";
import { senderInitials } from "@/lib/message-author";
import { personPhotoUrl } from "../../shared/person-identity";
import type { ResolvedSender } from "../../shared/wire";
import { InitialsAvatar } from "./Avatar";

export function RoomPerson({ person, children }: { person: Pick<ResolvedSender, "name" | "email" | "avatarUrl">; children?: ReactNode }) {
  return (
    <div data-room-person="" className="mt-2 flex w-full items-end gap-2.5">
      <span className="flex w-7 shrink-0 justify-center pb-0.5" title={person.email}>
        <InitialsAvatar initials={senderInitials(person.name)} avatarUrl={personPhotoUrl(person.avatarUrl)} size={28} />
      </span>
      <div className="min-w-0 flex-1">
        <div data-room-person-name="" className="text-[11.5px] text-ink-secondary">{person.name}</div>
        {children}
      </div>
    </div>
  );
}
