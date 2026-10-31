import { describe, expect, it } from "vitest";

import { liveConsentAssistable } from "./live-approval.ts";

describe("liveConsentAssistable", () => {
  it.each(["sim, pode rodar", "pode sim", "claro, manda ver", "sí, adelante", "absolutely, go for it"])("lets the model read %s", (said) => {
    expect(liveConsentAssistable(said)).toBe(true);
  });

  it.each([
    "", "pode rodar?", "sim, mas só depois", "não", "nao pode", "espera", "yes but not now", "only the first one", "se der, pode",
    "pode, porém troca o arquivo", "talvez", "sim ".repeat(30),
  ])("keeps %j for the rule alone", (said) => {
    expect(liveConsentAssistable(said)).toBe(false);
  });
});
