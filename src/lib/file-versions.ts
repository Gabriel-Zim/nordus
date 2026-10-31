import type { Message } from "@/state/store";

function nameOf(attachment: { path: string; name?: string }): string {
  return (attachment.name ?? attachment.path.split(/[\\/]/).pop() ?? attachment.path).toLowerCase();
}

/** Per bot message, the version of each file it delivered: the second delivery of "proposta.pdf" in a thread is v2. */
export function producedFileVersions(messages: readonly Message[]): Map<string, Map<string, number>> {
  const seen = new Map<string, number>();
  const out = new Map<string, Map<string, number>>();
  for (const message of messages) {
    if (message.role !== "bot" || !message.attachments?.length) continue;
    const versions = new Map<string, number>();
    for (const attachment of message.attachments) {
      if (attachment.kind === "audio") continue;
      const name = nameOf(attachment);
      if (versions.has(name)) continue;
      const version = (seen.get(name) ?? 0) + 1;
      seen.set(name, version);
      versions.set(name, version);
    }
    if (versions.size) out.set(message.id, versions);
  }
  return out;
}

export function fileVersionKey(file: { path: string; name?: string }): string {
  return nameOf(file);
}
