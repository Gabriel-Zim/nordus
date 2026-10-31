import type { BoardMission, MissionReceipt, MissionReceiptAgent } from "../../shared/board.ts";

export interface UsageLine {
  botId: string;
  botName: string;
  threadId: string;
  input: number;
  output: number;
  costUsd: number | null;
}

export function buildReceipt(
  mission: Pick<BoardMission, "createdAt" | "startedAt" | "finishedAt" | "threadId">,
  lines: readonly UsageLine[],
  now: number,
  withMoney: boolean,
): MissionReceipt {
  const from = mission.startedAt ?? mission.createdAt;
  const to = mission.finishedAt ?? now;
  const byBot = new Map<string, MissionReceiptAgent>();
  const total: MissionReceipt["total"] = { turns: 0, input: 0, output: 0, ...(withMoney ? { costUsd: null } : {}) };
  for (const line of lines) {
    if (line.threadId !== mission.threadId) continue;
    const agent = byBot.get(line.botId) ?? { botId: line.botId, name: line.botName || line.botId, turns: 0, input: 0, output: 0, ...(withMoney ? { costUsd: null } : {}) };
    agent.turns += 1;
    agent.input += line.input;
    agent.output += line.output;
    total.turns += 1;
    total.input += line.input;
    total.output += line.output;
    if (withMoney && line.costUsd !== null) {
      agent.costUsd = (agent.costUsd ?? 0) + line.costUsd;
      total.costUsd = (total.costUsd ?? 0) + line.costUsd;
    }
    byBot.set(line.botId, agent);
  }
  const agents = [...byBot.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
  return { from, to, agents, total };
}
