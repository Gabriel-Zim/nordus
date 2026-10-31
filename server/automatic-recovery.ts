import type { ProviderAdapter } from "./contracts.ts";
import { supportsWorkspaceFiles } from "./workspace.ts";

type Engine = { driverKind: string; capabilities: ProviderAdapter["capabilities"] };

/** An automatic switch must not strand the task without its tools or move its filesystem to another machine. */
export function recoveryCapabilityError(from: Engine, to: Engine): string | undefined {
  if (supportsWorkspaceFiles(from.driverKind) !== supportsWorkspaceFiles(to.driverKind)) {
    return "The backup cannot use the same workspace.";
  }
  const tools = ["agentsMcp", "computerMcp", "composioMcp", "dataMcp", "highlevelMcp",
    "phoneMcp", "browserMcp", "localComputerMcp", "customMcp", "images"] as const;
  if (tools.some(key => from.capabilities[key] === true && to.capabilities[key] !== true)) {
    return "The backup does not support all of this AI's tools and attachments.";
  }
}

/** Among eligible backups, the first that keeps every tool and attachment; otherwise the first, so the refusal can say why. */
export function preferCompatibleBackup(indexes: number[], compatible: (index: number) => boolean): number {
  return indexes.find(compatible) ?? indexes[0] ?? -1;
}

/** The text a person reads when no backup could take over; the original error stays at the end because refusal detection reads it. */
export function recoveryUnavailableMessage(refusal: string, original: string): string {
  const capability = refusal.includes("tools and attachments") || refusal.includes("same workspace");
  const lead = capability
    ? "A recuperação automática não pôde continuar porque a reserva não tem todas as ferramentas e anexos desta IA. Troque a conta ou o modelo do robô nas configurações dele para seguir."
    : `A recuperação automática não está disponível: ${refusal}`;
  return `${lead} Original error: ${original}`;
}
