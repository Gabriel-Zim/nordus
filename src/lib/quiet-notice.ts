import { t } from "@/lib/i18n";

const DURATION = String.raw`(\d+ (?:s|min))`;

const RETRYING = new RegExp(
  String.raw`^(.+?) (hit a rate limit \(HTTP 429\)|got a server error from its model provider \(HTTP (\d+)\)|got an error from its model provider \(HTTP (\d+)\)|had a failed model request)` +
    String.raw` and is retrying(?: \(attempt (\d+)\))?\.(?: Next try in (\d+) s\.)? It is still working\.$`,
);

const PLAIN: { pattern: RegExp; render: (m: RegExpMatchArray) => string }[] = [
  {
    pattern: /^(.+?) is compressing its conversation history to make room\. This can take a few minutes; it is still working\.$/,
    render: (m) => t("quiet.compressing", { name: m[1]! }),
  },
  {
    pattern: new RegExp(String.raw`^(.+?) is waiting on its model: no reply for ${DURATION}, but its request is still open\. Its history is nearly full, so it may be compressing it\.$`),
    render: (m) => t("quiet.waitingModelFull", { name: m[1]!, quiet: m[2]! }),
  },
  {
    pattern: new RegExp(String.raw`^(.+?) is waiting on its model: no reply for ${DURATION}, but its request is still open\. Slow models and rate limits look like this\.$`),
    render: (m) => t("quiet.waitingModel", { name: m[1]!, quiet: m[2]! }),
  },
  {
    pattern: new RegExp(String.raw`^(.+?) is busy on this computer but has sent nothing for ${DURATION}\.$`),
    render: (m) => t("quiet.busy", { name: m[1]!, quiet: m[2]! }),
  },
  {
    pattern: new RegExp(String.raw`^(.+?) has sent nothing for ${DURATION} and has no request open to its model right now\. It may be waiting before a retry\. Still waiting; press Stop to end the turn\.$`),
    render: (m) => t("quiet.betweenRequests", { name: m[1]!, quiet: m[2]! }),
  },
  {
    pattern: new RegExp(String.raw`^(.+?) has sent nothing for ${DURATION}, has no open request to its model, and is not using the CPU\. It may be stuck\. Press Stop to end the turn; otherwise it is stopped after ${DURATION} of silence\.$`),
    render: (m) => t("quiet.noSigns", { name: m[1]!, quiet: m[2]!, stop: m[3]! }),
  },
  {
    pattern: new RegExp(String.raw`^(.+?) has sent nothing for ${DURATION}\. Still waiting; press Stop to end the turn\.$`),
    render: (m) => t("quiet.unknown", { name: m[1]!, quiet: m[2]! }),
  },
];

function retrying(m: RegExpMatchArray): string {
  const [, name, phrase, server, other, attempt, seconds] = m;
  const why = phrase!.startsWith("hit a rate limit") ? t("quiet.why.rate")
    : server ? t("quiet.why.server", { status: server })
    : other ? t("quiet.why.error", { status: other })
    : t("quiet.why.failed");
  return t("quiet.retrying", {
    name: name!,
    why,
    attempt: attempt ? t("quiet.attempt", { attempt }) : "",
    next: seconds ? t("quiet.next", { seconds }) : "",
  });
}

export function localizeQuietNotice(text: string): string {
  const retry = RETRYING.exec(text);
  if (retry) return retrying(retry);
  for (const { pattern, render } of PLAIN) {
    const match = pattern.exec(text);
    if (match) return render(match);
  }
  return text;
}
