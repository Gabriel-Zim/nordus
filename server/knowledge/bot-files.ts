import { guestWorkspaceToHost } from "../bot-attachment.ts";
import { openMessageFile, type OpenedMessageFile } from "../message-file.ts";

/** A file the agent names, opened through the same hardened resolver the chat uses: inside its own folders, never through a link. */
export async function openBotFile(input: { path: string; roots: readonly string[]; guest?: { root: string; host: string } }): Promise<OpenedMessageFile> {
  const requested = input.path.trim();
  if (!requested) throw Object.assign(new Error("path is required"), { status: 400 });
  const guestHost = input.guest ? guestWorkspaceToHost(requested, input.guest.root, input.guest.host) : null;
  const roots = input.guest ? [input.guest.host, ...input.roots] : input.roots;
  return openMessageFile(guestHost ?? requested, roots);
}
