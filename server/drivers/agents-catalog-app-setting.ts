// The propose_app_setting definition, kept in its own file so the catalog stays within its line budget.
import { APP_SETTING_VALUES } from "../../shared/app-setting-request.ts";

export const CHIEF_PROFILE_TARGET = " A Chief of Staff may pass for_bot_id (from list_bots) for a requested change to another bot in its section.";
const SELF_CHANGE_OUTCOME = " Read the result: a change to your own routines, skills, profile or model applies immediately, and the person sees it with an Undo; a change for another bot may wait for the person's confirmation. If applied, continue the requested work without another confirmation. Only a pending result requires ending the turn and waiting for the in-app decision. Never claim success without an applied result; report failed or cancelled results honestly. This does not elevate another bot's execution permissions.";

export const APP_SETTING_TOOL = {
    name: "propose_app_setting",
    description:
      "Submit a user-requested change to the app: its language, its look (theme), the simple or advanced interface, or a bot's approval level (ask, edits, auto or full). Use the exact value the person named; these are the only accepted values. Language, theme and interface change this app on this device at once, and approval_mode changes the named bot's conversations. Every change to a bot's approval level, up or down, waits for the person's confirmation on a card; never say it is on." + CHIEF_PROFILE_TARGET + SELF_CHANGE_OUTCOME,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        setting: {
          type: "string",
          enum: ["language", "theme", "interface_mode", "approval_mode"],
          description: "language, theme, interface_mode (simple or advanced), or approval_mode for the named bot.",
        },
        value: {
          type: "string",
          enum: APP_SETTING_VALUES,
          description: "The new value. language: en, de, es, fr, hi, ja, pt-br, zh, zh-tw, uk, vi or tr. theme: dark, light or auto. interface_mode: simple or advanced. approval_mode: ask, edits, auto or full.",
        },
        reason: { type: "string", minLength: 1, maxLength: 500, description: "One sentence the user will see explaining why." },
        for_bot_id: {
          type: "string",
          description: "Chief of Staff only, and only for approval_mode: the id of another bot in your section whose approval level this changes. Omit to change your own.",
        },
      },
      required: ["setting", "value", "reason"],
    },
} as const;

export const CHIEF_ONLY_TOOL_NAMES = new Set([
  "create_bot", "list_team_setup", "list_team_library", "propose_team_setup", "propose_bot_deletion", "create_room", "manage_room", "retry_thread",
]);
export const CHIEF_TARGET_TOOL_NAMES = new Set(["propose_profile", "propose_model", "propose_app_setting"]);
