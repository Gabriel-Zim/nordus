import { PROBLEM_REPORT_EXCERPT_CHOICES, type DoctorReport, type ProblemReportPreview, type ProblemReportSent } from "../../shared/doctor.ts";
import { buildProblemReport, reportTarget, reportTitle, sanitizeReport } from "../problem-report.ts";
import { redactSecretsInText } from "../redact.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord, Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProblemReportRouteDeps {
  store: Pick<Store, "bots" | "botByThread" | "taskByThread" | "messagesFor" | "createTask" | "deleteTasks">;
  version(): string;
  latestDoctor(): DoctorReport | null;
  threadBusy(botId: string, threadId: string): boolean;
  isInternal(bot: BotRecord): boolean;
  /** The same path a person's own message takes, so the queue and limits apply. Throws when the send is refused. */
  send(input: { botId: string; threadId: string; text: string; auth: RequestAuth }): Promise<unknown>;
  now?: () => number;
}

const DESCRIPTION_MAX = 2_000;
export const REPORT_PER_THREAD_MS = 5 * 60_000;
export const REPORTS_PER_HOUR = 10;
const HOUR_MS = 60 * 60_000;

/** Each report starts a paid turn, and a bot on loopback counts as the owner, so sends are rationed. */
export function createReportLimiter(now: () => number) {
  const lastByThread = new Map<string, number>();
  let recent: number[] = [];
  return {
    refusal(threadId: string): string | null {
      const at = now();
      recent = recent.filter((sent) => at - sent < HOUR_MS);
      const last = lastByThread.get(threadId);
      if (last !== undefined && at - last < REPORT_PER_THREAD_MS) return "Esta conversa já foi relatada há pouco. Espere 5 minutos para mandar outro relato.";
      if (recent.length >= REPORTS_PER_HOUR) return "Já foram mandados muitos relatos na última hora. Espere um pouco antes de mandar outro.";
      return null;
    },
    note(threadId: string): void {
      const at = now();
      lastByThread.set(threadId, at);
      recent.push(at);
    },
  };
}

/** Admin only, and nothing leaves the server: the package becomes a task for an internal robot. */
export function createProblemReportRoutes(deps: ProblemReportRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const limiter = createReportLimiter(now);
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/threads\/([\w-]+)\/problem-report(\/preview)?$/);
    if (!m || method !== "POST") return PASS;
    const threadId = m[1];
    const bot = deps.store.botByThread(threadId);
    if (!bot) return json(res, 404, { error: "Essa conversa não existe." });
    const target = reportTarget(deps.store.bots, bot.id, deps.isInternal);
    if (!target) return json(res, 409, { error: "Não há TECNICO nem Boss interno neste servidor para receber o relato." });
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "O pedido veio incompleto. Tente de novo." });
    const description = typeof body.description === "string" ? body.description.slice(0, DESCRIPTION_MAX) : "";

    if (m[2]) {
      const excerpt = PROBLEM_REPORT_EXCERPT_CHOICES.find((choice) => choice === body.excerpt) ?? 0;
      const task = deps.store.taskByThread(bot.id, threadId);
      const preview: ProblemReportPreview = {
        target,
        text: buildProblemReport({
          version: deps.version(), at: now(), description, bot, threadId, excerpt, target,
          forClient: Boolean(task?.clients?.length || bot.client),
          taskTitle: task?.title ?? null,
          turn: {
            busy: deps.threadBusy(bot.id, threadId),
            ...(task?.activity ? { activity: String(task.activity) } : {}),
            waitingForTeammates: task?.waitingForTeammates === true,
            archived: task?.archivedAt !== undefined,
          },
          messages: deps.store.messagesFor(threadId),
          doctor: deps.latestDoctor(),
        }),
      };
      return json(res, 200, preview);
    }

    if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { error: "Monte a prévia antes de enviar." });
    const refusal = limiter.refusal(threadId);
    if (refusal) return json(res, 429, { error: refusal });
    limiter.note(threadId);
    const task = deps.store.createTask(target.botId, reportTitle(redactSecretsInText(description)), false);
    if (!task) return json(res, 500, { error: "Não consegui abrir a tarefa para o relato." });
    try {
      await deps.send({ botId: target.botId, threadId: task.threadId, text: sanitizeReport(body.text), auth });
    } catch (error) {
      deps.store.deleteTasks(target.botId, [task.threadId]);
      console.warn(`problem report for thread ${threadId} not delivered: ${error instanceof Error ? error.message : String(error)}`);
      return json(res, 409, { error: `${target.name} não pôde receber o relato agora. Tente de novo em alguns minutos.` });
    }
    const sent: ProblemReportSent = { target, threadId: task.threadId };
    return json(res, 201, sent);
  };
}
