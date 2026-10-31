import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlanLimit, PLAN_LIMIT_FALLBACK_MS, PLAN_LIMIT_RESUME_TEXT } from "./plan-limit.ts";

describe("plan limit pause", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T10:00:00")); });
  afterEach(() => { vi.useRealTimers(); });

  const make = () => {
    const resume = vi.fn();
    const notify = vi.fn();
    const drain = vi.fn();
    const planLimit = createPlanLimit({
      drain,
      now: () => Date.now(),
      setTimer: (ms, fn) => { setTimeout(fn, ms); },
      resume,
      notify,
    });
    return { planLimit, resume, notify, drain };
  };
  const inSeconds = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;

  it("tells each desk once per window, however many tasks hit the limit", () => {
    const { planLimit, notify } = make();
    planLimit.onLimit("t1", "desk1", inSeconds(3600));
    planLimit.onLimit("t2", "desk1", inSeconds(3600));
    planLimit.onLimit("t3", "desk1", inSeconds(3600));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Pausei as tarefas: o limite do plano acabou. Retomo sozinho por volta das 11:00.", ["desk1"]);
    planLimit.onLimit("t4", "desk2", inSeconds(3600));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("blocks until the reset and not after", () => {
    const { planLimit } = make();
    expect(planLimit.blocked()).toBe(false);
    planLimit.onLimit("t1", "desk1", inSeconds(600));
    expect(planLimit.blocked()).toBe(true);
    vi.advanceTimersByTime(599_000);
    expect(planLimit.blocked()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(planLimit.blocked()).toBe(false);
  });

  it("resumes each paused task once when the timer fires", () => {
    const { planLimit, resume } = make();
    planLimit.onLimit("t1", "desk1", inSeconds(600));
    planLimit.onLimit("t2", "desk1", inSeconds(600));
    planLimit.onLimit("t1", "desk1", inSeconds(600));
    expect(planLimit.paused("t1")).toBe(true);
    vi.advanceTimersByTime(600_000);
    expect(resume.mock.calls.map((call) => call[0]).sort()).toEqual(["t1", "t2"]);
    expect(planLimit.paused("t1")).toBe(false);
    vi.advanceTimersByTime(3_600_000);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("falls back to 30 minutes when the reset time is unknown", () => {
    const { planLimit, resume, notify } = make();
    planLimit.onLimit("t1", "desk1", null);
    expect(notify).toHaveBeenCalledWith("Pausei as tarefas: o limite do plano acabou. Tento retomar em 30 minutos.", ["desk1"]);
    vi.advanceTimersByTime(PLAN_LIMIT_FALLBACK_MS - 1);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resume).toHaveBeenCalledWith("t1");
  });

  it("opens a new window and a new notice when the limit hits again after resuming", () => {
    const { planLimit, notify } = make();
    planLimit.onLimit("t1", "desk1", null);
    vi.advanceTimersByTime(PLAN_LIMIT_FALLBACK_MS);
    planLimit.onLimit("t1", "desk1", null);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("drains the queue after resuming, even with nothing to resume", () => {
    const { planLimit, resume, drain } = make();
    planLimit.onLimit("t1", "desk1", inSeconds(180));
    vi.advanceTimersByTime(179_000);
    expect(drain).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain.mock.invocationCallOrder[0]).toBeGreaterThan(resume.mock.invocationCallOrder[0]);
  });

  it("has the exact resume text", () => {
    expect(PLAN_LIMIT_RESUME_TEXT).toBe("Continue de onde parou. Antes de repetir qualquer ação externa (publicar, enviar, gravar fora da pasta do pedido), confira o que já foi feito.");
  });

  it("a reset time already past waits at least two minutes instead of looping", () => {
    const { planLimit, resume } = make();
    planLimit.onLimit("t1", "desk1", inSeconds(-3600));
    vi.advanceTimersByTime(60_000);
    expect(resume).not.toHaveBeenCalled();
    expect(planLimit.blocked()).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("pauseLine names the return time when known, 30 minutes when not, and nothing outside a window", () => {
    const { planLimit } = make();
    expect(planLimit.pauseLine("X")).toBeNull();
    planLimit.onLimit("t1", "desk1", inSeconds(3600));
    expect(planLimit.pauseLine("X")).toBe("Pausado pelo limite do plano: X. Volta por volta das 11:00.");
    vi.advanceTimersByTime(3_600_000);
    planLimit.onLimit("t2", "desk1", null);
    expect(planLimit.pauseLine("X")).toBe("Pausado pelo limite do plano: X. Tento retomar em 30 minutos.");
  });
});
