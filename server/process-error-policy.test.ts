import { describe, expect, it, vi } from "vitest";
import { createProcessErrorPolicy } from "./process-error-policy.ts";

function setup() {
  let t = 1_000_000;
  const logError = vi.fn();
  const exit = vi.fn();
  const policy = createProcessErrorPolicy({ now: () => t, logError, exit });
  return { policy, logError, exit, advance: (ms: number) => { t += ms; } };
}

describe("process-error-policy", () => {
  it("registra rejeição sem sair", () => {
    const { policy, logError, exit } = setup();
    policy.onUnhandledRejection(new Error("x"));
    expect(logError).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
  });
  it("registra exceção sem sair", () => {
    const { policy, logError, exit } = setup();
    policy.onUncaughtException(new Error("x"));
    expect(logError).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
  });
  it("sai em falta de memória", () => {
    const { policy, exit } = setup();
    policy.onUncaughtException(Object.assign(new Error("oom"), { code: "ERR_OUT_OF_MEMORY" }));
    expect(exit).toHaveBeenCalledWith(1);
  });
  it("sai com 70 na tempestade", () => {
    const { policy, exit, advance } = setup();
    for (let i = 0; i < 5; i++) { policy.onUncaughtException(new Error("e")); advance(1000); }
    expect(exit).toHaveBeenCalledWith(70);
    expect(exit).toHaveBeenCalledTimes(1);
  });
  it("contagem expira após 60 s", () => {
    const { policy, exit, advance } = setup();
    for (let i = 0; i < 4; i++) policy.onUncaughtException(new Error("e"));
    advance(61_000);
    for (let i = 0; i < 4; i++) policy.onUncaughtException(new Error("e"));
    expect(exit).not.toHaveBeenCalled();
  });
});
