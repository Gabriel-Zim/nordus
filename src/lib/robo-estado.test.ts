import { describe, expect, it } from "vitest";
import { CRITTER_COLORS } from "@/lib/mascot";
import { ROBO_CASCA, ROBO_CORPOS, engineDown, roboAparencia, roboEstado, roboEstadoDoBot } from "./robo-estado";
import type { InstanceInfo } from "@/state/store";

const quiet = { waiting: false, working: false };

describe("roboEstado", () => {
  it("maps the five moments", () => {
    expect(roboEstado(quiet)).toBe("online");
    expect(roboEstado({ ...quiet, working: true })).toBe("trabalhando");
    expect(roboEstado({ ...quiet, waiting: true })).toBe("alerta");
    expect(roboEstado({ ...quiet, vmStopped: true })).toBe("ausente");
    expect(roboEstado({ ...quiet, activity: "dead" })).toBe("offline");
  });

  it("puts an approval above everything a bot is doing", () => {
    expect(roboEstado({ waiting: true, working: true, activity: "no-signal", vmStopped: true })).toBe("alerta");
  });

  it("treats a stalled engine as stopped even mid-turn, but real work above a dead sibling thread", () => {
    expect(roboEstado({ ...quiet, working: true, activity: "no-signal" })).toBe("offline");
    expect(roboEstado({ ...quiet, working: true, activity: "dead" })).toBe("trabalhando");
  });

  it("is offline when its engine is unavailable or the bot is archived, and away only when idle with its VM off", () => {
    expect(roboEstado({ ...quiet, engineDown: true, vmStopped: true })).toBe("offline");
    expect(roboEstado({ ...quiet, archived: true, working: true })).toBe("offline");
    expect(roboEstado({ ...quiet, working: true, vmStopped: true })).toBe("trabalhando");
  });

  it("reads a bare bot record", () => {
    expect(roboEstadoDoBot({ activity: "idle" })).toBe("online");
    expect(roboEstadoDoBot({ activity: "working", busy: true })).toBe("trabalhando");
    expect(roboEstadoDoBot({ activity: "waiting-on-you", busy: true })).toBe("alerta");
    expect(roboEstadoDoBot({ activity: "no-signal", busy: true })).toBe("offline");
  });
});

describe("engineDown", () => {
  const instance = (instanceId: string, state: "available" | "unavailable") =>
    ({ instanceId, driverKind: "claude", displayName: instanceId, snapshot: { state } }) as InstanceInfo;

  it("is down only when the bot's own engine reports unavailable", () => {
    const bot = { modelSelection: { instanceId: "claude", model: "x" } };
    expect(engineDown(bot, [])).toBe(false);
    expect(engineDown(bot, [instance("claude", "available")])).toBe(false);
    expect(engineDown(bot, [instance("codex", "unavailable")])).toBe(false);
    expect(engineDown(bot, [instance("claude", "unavailable")])).toBe(true);
  });
});

describe("roboAparencia", () => {
  it("is a graphite shell lit in the bot's identity colour, with a body that stays put", () => {
    const look = roboAparencia({ id: "design", color: "purple" });
    expect(look.casca).toBe(ROBO_CASCA);
    expect(look.luz).toBe(CRITTER_COLORS.purple);
    expect(look.genero).toBe("m");
    expect(ROBO_CORPOS).toContain(look.corpo);
    expect(roboAparencia({ id: "design", color: "blue" }).corpo).toBe(look.corpo);
  });

  it("varies the body across a team", () => {
    const bodies = new Set(["diretor", "plum", "design", "social", "financeiro", "suporte", "atlas", "projetistaderobos"]
      .map((id) => roboAparencia({ id, color: "green" }).corpo));
    expect(bodies.size).toBeGreaterThan(2);
  });

  it("draws the look saved on the bot, field by field", () => {
    expect(roboAparencia({ id: "plum", color: "cyan", robot: { body: "cintura", gender: "f", shell: "#e6e8ec", light: "#2ec5ff", dress: "#5a2030" } }))
      .toEqual({ corpo: "cintura", genero: "f", casca: "#e6e8ec", luz: "#2ec5ff", roupa: "#5a2030" });
    const shellOnly = roboAparencia({ id: "plum", color: "cyan", robot: { shell: "#6b5a45" } });
    expect(shellOnly).toEqual({ ...roboAparencia({ id: "plum", color: "cyan" }), casca: "#6b5a45" });
    expect(roboAparencia({ id: "plum", color: "cyan", robot: null })).toEqual(roboAparencia({ id: "plum", color: "cyan" }));
  });
});
