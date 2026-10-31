import { CRITTER_COLORS } from "@/lib/mascot";
import type { Bot, InstanceInfo } from "@/state/store";
import { ROBOT_BODIES, type RobotBody } from "../../shared/robot-look";

export type RoboEstado = "online" | "trabalhando" | "alerta" | "ausente" | "offline";
export type RoboCorpo = RobotBody;
export type RoboGenero = "m" | "f";

export const ROBO_CORPOS: readonly RoboCorpo[] = ROBOT_BODIES;

export const ROBO_CASCA = "#3a3a3a";
export const ROBO_CASCAS = ["#3a3a3a", "#222326", "#5a5f66", "#e6e8ec", "#2c3a4f", "#3d4a3f", "#4a3f5e", "#6b5a45"] as const;
export const ROBO_LUZES = ["#ff9a18", "#ffd23a", "#ff7a3c", "#2ec5ff", "#4f7cff", "#3dff9a", "#c39bff", "#ff4d6a", "#f2f5ff"] as const;
export const ROBO_ROUPAS = ["#1c1c1e", "#e9e9ec", "#5a2030", "#26324a", "#34463a", "#b9a07a"] as const;

export interface RoboAparencia {
  corpo: RoboCorpo;
  genero: RoboGenero;
  casca: string;
  luz: string;
  roupa?: string;
}

export function corpoPadrao(seed: string): RoboCorpo {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return ROBO_CORPOS[hash % ROBO_CORPOS.length];
}

export function luzPadrao(color: Bot["color"]): string {
  return CRITTER_COLORS[color] ?? CRITTER_COLORS.orange;
}

export function roboAparencia(bot: Pick<Bot, "color" | "robot"> & { id?: string; name?: string }): RoboAparencia {
  const look = bot.robot ?? {};
  return {
    corpo: look.body ?? corpoPadrao(bot.id ?? bot.name ?? ""),
    genero: look.gender ?? "m",
    casca: look.shell ?? ROBO_CASCA,
    luz: look.light ?? luzPadrao(bot.color),
    ...(look.dress ? { roupa: look.dress } : {}),
  };
}

export interface RoboSinais {
  activity?: Bot["activity"];
  waiting: boolean;
  working: boolean;
  engineDown?: boolean;
  vmStopped?: boolean;
  archived?: boolean;
}

export function roboEstado(sinais: RoboSinais): RoboEstado {
  if (sinais.archived) return "offline";
  if (sinais.waiting) return "alerta";
  if (sinais.activity === "no-signal") return "offline";
  if (sinais.working) return "trabalhando";
  if (sinais.activity === "dead" || sinais.engineDown) return "offline";
  if (sinais.vmStopped) return "ausente";
  return "online";
}

export function engineDown(bot: Pick<Bot, "modelSelection">, instances: InstanceInfo[]): boolean {
  return instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.snapshot.state === "unavailable";
}

export function roboEstadoDoBot(bot: Pick<Bot, "activity" | "busy">): RoboEstado {
  return roboEstado({
    activity: bot.activity,
    waiting: bot.activity === "waiting-on-you",
    working: Boolean(bot.busy) || bot.activity === "working",
  });
}
