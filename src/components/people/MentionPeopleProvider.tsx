import { useMemo, type ReactNode } from "react";

import { MentionPeopleContext, mentionablePeople, type MentionPeopleValue } from "@/lib/mention-people";
import { useViewer } from "@/lib/use-viewer";
import { useDirectory } from "@/state/people-directory";
import type { Group } from "@/state/store";

/** Lets everything inside a channel name its people: the @ list in the composer and the highlight in messages. */
export function MentionPeopleProvider({ group, children }: { group: Pick<Group, "dm" | "general" | "people">; children: ReactNode }) {
  const viewer = useViewer();
  const { people: directory } = useDirectory();
  const value = useMemo<MentionPeopleValue>(
    () => ({ people: mentionablePeople(group, directory), self: viewer.email }),
    [group.dm, group.general, group.people, directory, viewer.email],
  );
  return <MentionPeopleContext.Provider value={value}>{children}</MentionPeopleContext.Provider>;
}
