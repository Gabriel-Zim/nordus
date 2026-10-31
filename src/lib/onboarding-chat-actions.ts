import { completionPatch } from "@/lib/onboarding";
import { readyBot } from "@/lib/ready-bots";
import type { ConfigStatus } from "@/state/config-status";
import type { api, Bot } from "@/state/store";
import {
  ABOUT_MAX,
  AGENT_ROLE_IDS,
  COMPANY_MAX,
  chosenAgents,
  companyBlock,
  mergeCompanyBlock,
  oneLine,
  type AgentProposal,
} from "./onboarding-chat";
import { createStarterTeam, type StarterTeamMember, type StarterTeamResult } from "./starter-team";

type Request = typeof api;

const SHARED_INSTRUCTIONS = "/api/section-context?section=";
const DEFAULT_LIMIT_BYTES = 24_000;

const COORDINATION =
  "You lead this small team. Break the request into parts, hand each part to the teammate best suited to it, then report back as one clear answer. Never invent a teammate's result.";

/** The shared instructions would outgrow their limit; the person's own text is never cut to make room. */
export class SharedInstructionsFullError extends Error {
  constructor() {
    super("The team's shared instructions have no room for another paragraph");
    this.name = "SharedInstructionsFullError";
  }
}

export async function saveCompanyName(request: Request, company: string): Promise<string> {
  const name = oneLine(company, COMPANY_MAX);
  const config = await request<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { company: name } }) });
  return config.profile?.company ?? name;
}

/** Writes what the company does into the General team's shared instructions, replacing only this welcome's own paragraph. */
export async function saveCompanyContext(request: Request, input: { company: string; about: string }): Promise<void> {
  const current = await request<{ text?: string; maxBytes?: number }>(SHARED_INSTRUCTIONS);
  const block = companyBlock({ company: oneLine(input.company, COMPANY_MAX), about: oneLine(input.about, ABOUT_MAX) });
  const next = mergeCompanyBlock(current.text ?? "", block);
  if (new TextEncoder().encode(next).length > (current.maxBytes ?? DEFAULT_LIMIT_BYTES)) throw new SharedInstructionsFullError();
  await request(SHARED_INSTRUCTIONS, { method: "PUT", body: JSON.stringify({ text: next }) });
}

export function agentMembers(proposals: readonly AgentProposal[]): StarterTeamMember[] {
  return chosenAgents(proposals).map((entry) => {
    const role = readyBot(AGENT_ROLE_IDS[entry.id]);
    if (!role) throw new Error(`Unknown built-in role for ${entry.id}`);
    return {
      key: `onboarding-${entry.id}`,
      roleId: role.id,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      soul: entry.id === "coordinator" ? `${role.soul} ${COORDINATION}` : role.soul,
    };
  });
}

export function createChosenTeam(request: Request, existing: readonly Bot[], proposals: readonly AgentProposal[]): Promise<StarterTeamResult> {
  const members = agentMembers(proposals);
  if (!members.length) return Promise.reject(new Error("Choose at least one agent"));
  return createStarterTeam(request, { existing, members });
}

export async function completeOnboarding(request: Request): Promise<ConfigStatus> {
  return request<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify(completionPatch()), signal: AbortSignal.timeout(10_000) });
}
