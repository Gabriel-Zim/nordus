interface ContactLine {
  role: string;
  text?: string;
  peerAsk?: unknown;
  relayed?: boolean;
  via?: string;
}

const KEPT = 20_000;

/** The contacts a person vouched for: only what they typed themselves, never a bot, a teammate's ask, an API line or a relayed card. */
export function knownContactsText(lines: readonly ContactLine[]): string {
  return lines
    .filter(line => line.role === "user" && !line.peerAsk && !line.relayed && line.via !== "api")
    .map(line => line.text ?? "")
    .join(" ")
    .slice(-KEPT);
}
