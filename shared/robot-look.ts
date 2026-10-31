import { z } from "zod";

import type { WireRobotLook } from "./wire.ts";

export const ROBOT_BODIES = ["peito", "cintura", "capsula", "robusto", "esfera"] as const satisfies readonly NonNullable<WireRobotLook["body"]>[];
export type RobotBody = (typeof ROBOT_BODIES)[number];
export type RobotLook = WireRobotLook;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: "robot colours must be #rrggbb" });

export const robotLookSchema: z.ZodType<RobotLook> = z.object({
  body: z.enum(ROBOT_BODIES, { error: `robot body must be ${ROBOT_BODIES.join(", ")}` }).optional(),
  gender: z.enum(["m", "f"], { error: "robot gender must be m or f" }).optional(),
  shell: hexColor.optional(),
  light: hexColor.optional(),
  dress: hexColor.optional(),
}).strict();
