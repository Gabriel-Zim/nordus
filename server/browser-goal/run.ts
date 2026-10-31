// The goal loop, ported from jev-ultrafast 1231850a agent.py and browser.py (MIT): observe, let Jev choose one observed
// operation, re-check that the page is the one it chose on, act with real input, observe again.
import type { Decider } from "../decider/index.ts";
import { monthForward } from "./calendar.ts";
import { choose, fieldText, type FieldContext, type HistoryItem, type PageAction, type PageState, type TextModel } from "./model.ts";
import { guardScript, MARKER, READ_PAGE_TEXT, READ_STATE, selectAllScript, settleScript, targetScript } from "./page-scripts.ts";

/** The bot's own browser, reached through its engine. */
export interface GoalPage {
  evaluate(script: string): Promise<unknown>;
  mouse(event: { type: "mousePressed" | "mouseReleased" | "mouseWheel"; x: number; y: number; button?: "left" | "none"; clickCount?: number; deltaX?: number; deltaY?: number }): Promise<void>;
  insertText(text: string): Promise<void>;
}

export type GoalStepKind = "read" | "click" | "fill" | "select" | "scroll" | "wait" | "cookies" | "dismiss";

export interface GoalStep {
  kind: GoalStepKind;
  /** What the step touched, in the page's own words. */
  label: string;
  /** The text typed into a field; never a secret, since secret fields are never offered. */
  text?: string;
  url: string;
  title: string;
  atMs: number;
}

export type GoalStatus = "done" | "blocked" | "approval" | "stopped" | "limit" | "unavailable";

export interface GoalOutcome {
  status: GoalStatus;
  reason: string;
  url: string;
  title: string;
  steps: GoalStep[];
  elapsedMs: number;
  pageText: string;
}

export interface GoalDeps {
  page: GoalPage;
  decider: Pick<Decider, "ask">;
  textModel: TextModel | null;
  onStep?(step: GoalStep): Promise<void> | void;
  stopped?(): boolean;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  fetch?: typeof fetch;
  /** Show the person each press with a pointer in the page, at no cost in time. */
  visible?: boolean;
}


export const GOAL_LIMITS = { actions: 40, decisions: 80, budgetMs: 90_000, decideMs: 10_000, textMs: 8_000, staleRetries: 16 } as const;
/** Checks in a row that may fail on a page that never holds still before the pilot goes on with what it last read. */
const MAX_CHANGED_PAGES = 3;
const PAGE_KEPT_CHANGING = "The page kept changing under the chosen control, so the step could not be taken.";

/** Controls that spend, book, send, publish, accept terms or delete: Jev never presses them; the bot asks first. */
const NEEDS_PERSON = /\b(?:reserv(?:ar|e|a agora)|confirm(?:ar|e) e pagar|confirmar (?:reserva|pagamento|compra|pedido)|pagar|pague|pay(?: now)?|comprar|compre|buy|purchase|(?<!data de )checkout(?! date)|finalizar (?:compra|pedido|reserva)|place order|fazer (?:o )?pedido|book(?: now| it)?|request to book|assinar|subscribe|enviar|send|publicar|publish|postar|aceito|concordo|aceitar (?:os )?termos|i agree|accept (?:the )?terms|excluir|apagar|delete|remover (?:minha )?conta|delete account)\b/iu;
const DISMISS = /^(?:dismiss\b.*|close(?: dialog| modal)?|fechar(?: janela)?|×|✕|x|no,? thanks|não,? obrigad[oa]|agora não|not now|maybe later|talvez depois|continuar sem (?:fazer login|entrar|login))$/iu;
/** A dialog this small covers the page: everything else is hidden behind it. */
const COVERED_MAX_CONTROLS = 6;
const MAX_MONTHS_FORWARD = 12;
/** A site's home page never holds a search goal already met, even when it shows past searches. */
const onHomePage = (page: PageState) => { try { const url = new URL(page.url); return url.pathname === "/" && !url.search; } catch { return false; } };
/** Paging and scrolling controls are pressed again on purpose. */
const PAGING = /\b(?:pr[oó]xim[oa]s?|seguinte|next|anterior|previous|ver mais|mostrar mais|carregar mais|show more|load more|more)\b/iu;
const COOKIE_PAGE = /\bcookies?\b/iu;
const REJECT_COOKIES = /\b(?:rejeitar|recusar|reject|decline|deny|negar)\b|(?:somente|apenas|só|only|use only)\s+(?:os\s+)?(?:cookies\s+)?(?:necess[aá]rios|essenciais|necessary|essential|required)|necessary only|essential only/iu;
const ACCEPT_ALL_COOKIES = /\b(?:aceitar|accept|allow|permitir)\s+(?:todos|tudo|all|cookies)\b|\b(?:aceitar|accept)\s+(?:os\s+)?cookies\b/iu;

class StalePage extends Error {}

/** A command that fails while the page navigates away is answered by reading the next page, not by giving up. */
function stale(error: unknown): never {
  throw new StalePage(error instanceof Error ? error.message : String(error));
}

function parsed<T>(value: unknown): T | null {
  let current = value;
  for (let depth = 0; depth < 2 && typeof current === "string"; depth++) {
    try { current = JSON.parse(current); } catch { return null; }
  }
  return current && typeof current === "object" ? current as T : null;
}

export async function runGoal(goal: string, deps: GoalDeps, limits: Partial<Record<keyof typeof GOAL_LIMITS, number>> = {}): Promise<GoalOutcome> {
  const limit = { ...GOAL_LIMITS, ...limits };
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const stopped = deps.stopped ?? (() => false);
  const started = now();
  const elapsed = () => Math.round(now() - started);
  const steps: GoalStep[] = [];
  const history: HistoryItem[] = [];
  const rejected = new Set<number>();
  const dismissed = new Set<number>();
  let decisions = 0;
  let advanced = 0;
  let changedPages = 0;
  let page: PageState | null = null;

  const evaluate = (script: string) => deps.page.evaluate(script).catch(stale);
  const mouse = (event: Parameters<GoalPage["mouse"]>[0]) => deps.page.mouse(event).catch(stale);
  const insertText = (text: string) => deps.page.insertText(text).catch(stale);
  const observe = async (): Promise<PageState> => {
    let last = "no answer";
    for (let attempt = 0; attempt < limit.staleRetries; attempt++) {
      const answer = await evaluate(READ_STATE).catch((error: Error) => { last = error.message; return null; });
      const state = parsed<PageState>(answer);
      if (state && Array.isArray(state.actions)) return state;
      if (answer !== null) last = `unreadable answer (${typeof answer}, ${String(answer).length} chars)`;
      await sleep(Math.min(50 * 2 ** attempt, 400));
    }
    throw new StalePage(`The page did not settle: ${last.slice(0, 300)}`);
  };
  const fresh = (state: PageState, action?: PageAction): Promise<boolean> => unchanged(state, action).catch((error: unknown) => {
    if (error instanceof StalePage) return false;
    throw error;
  });
  const unchanged = async (state: PageState, action?: PageAction): Promise<boolean> => {
    if (action && (action.kind === "click" || action.kind === "select" || action.kind === "fill") && action.node !== undefined) {
      const current = parsed<[string, string]>(await evaluate(guardScript(action.node)));
      return Boolean(current && current[0] === state.page_key && current[1] === state.guards[String(action.node)]);
    }
    return await evaluate(MARKER) === state.marker;
  };
  const step = async (kind: GoalStepKind, label: string, state: PageState, text?: string) => {
    const entry: GoalStep = { kind, label, url: state.url, title: state.title, atMs: elapsed(), ...(text !== undefined ? { text } : {}) };
    steps.push(entry);
    await deps.onStep?.(entry);
  };
  const press = async (state: PageState, action: PageAction): Promise<void> => {
    if (action.kind === "scroll") {
      await mouse({ type: "mouseWheel", x: 550, y: 400, deltaX: 0, deltaY: action.delta ?? 560 });
      return;
    }
    if (action.kind === "wait") { await sleep(300); return; }
    if (!await fresh(state, action)) throw new StalePage("The page changed since this decision.");
    const point = parsed<{ x: number; y: number }>(await evaluate(targetScript({ node: action.node!, kind: action.kind, value: action.value, pointer: deps.visible === true })));
    if (!point) throw new StalePage("The target moved or is covered.");
    if (action.kind === "select") return;
    await mouse({ type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await mouse({ type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const finish = async (status: GoalStatus, reason: string): Promise<GoalOutcome> => {
    const read = parsed<{ url: string; title: string; text: string }>(await evaluate(READ_PAGE_TEXT).catch(() => null));
    return {
      status, reason, steps, elapsedMs: elapsed(),
      url: read?.url ?? page?.url ?? "", title: read?.title ?? page?.title ?? "", pageText: read?.text ?? page?.text ?? "",
    };
  };

  try {
    page = await observe();
  } catch {
    return finish("unavailable", "The page did not answer.");
  }
  await step("read", page.title || page.url, page);

  while (true) {
    if (stopped()) return finish("stopped", "A person took the browser.");
    if (elapsed() > limit.budgetMs) return finish("limit", "Time ran out before the goal was met.");
    if (history.length >= limit.actions || decisions >= limit.decisions) return finish("limit", "The action budget ran out before the goal was met.");

    if (COOKIE_PAGE.test(page.text)) {
      const reject = page.actions.find((action) => action.kind === "click" && action.node !== undefined && !rejected.has(action.node) && REJECT_COOKIES.test(action.label));
      if (reject) {
        rejected.add(reject.node!);
        try {
          await press(page, reject);
          await evaluate(settleScript(reject)).catch(() => undefined);
          await step("cookies", reject.label, page);
        } catch (error) { if (!(error instanceof StalePage)) throw error; }
        page = await observe();
        continue;
      }
    }

    const controls = page.actions.filter((action) => action.node !== undefined);
    const dismiss = controls.length <= COVERED_MAX_CONTROLS
      ? controls.find((action) => action.kind === "click" && !dismissed.has(action.node!) && DISMISS.test(action.label.trim()))
      : undefined;
    if (dismiss) {
      dismissed.add(dismiss.node!);
      try {
        await press(page, dismiss);
        await evaluate(settleScript(dismiss)).catch(() => undefined);
        await step("dismiss", dismiss.label, page);
      } catch (error) { if (!(error instanceof StalePage)) throw error; }
      page = await observe();
      continue;
    }

    const forward = advanced < MAX_MONTHS_FORWARD ? monthForward(page, goal) : null;
    if (forward) {
      advanced++;
      try {
        await press(page, forward);
        await evaluate(settleScript(forward)).catch(() => undefined);
        await step("click", forward.label, page);
      } catch (error) { if (!(error instanceof StalePage)) throw error; }
      page = await observe();
      continue;
    }

    decisions++;
    let decision = await choose(deps.decider, page, goal, history, { timeoutMs: limit.decideMs });
    if (decision.ok && decision.choice === "DONE" && !history.length && onHomePage(page)) {
      decisions++;
      decision = await choose(deps.decider, page, goal, history, { timeoutMs: limit.decideMs, mustAct: true });
    }
    if (!decision.ok) return finish("unavailable", `The decision model did not answer (${decision.reason}).`);
    if (stopped()) return finish("stopped", "A person took the browser.");
    if (decision.choice === "DONE" || decision.choice === "BLOCKED") {
      if (!await fresh(page) && ++changedPages <= MAX_CHANGED_PAGES) { page = await observe(); continue; }
      return finish(decision.choice === "DONE" ? "done" : "blocked",
        decision.choice === "DONE" ? "The page shows the goal met." : "No observed control can move the goal forward.");
    }
    const action = decision.choice;
    if ((action.kind === "click" || action.kind === "select") && NEEDS_PERSON.test(action.label)) {
      return finish("approval", `The next step is “${action.label}”, which spends, books, sends, publishes, accepts terms or deletes. Ask the person before doing it.`);
    }
    if (action.kind === "click" && ACCEPT_ALL_COOKIES.test(action.label)) {
      return finish("blocked", `A cookie banner offers only “${action.label}”, with no way to refuse optional cookies.`);
    }

    let text: string | undefined;
    if (action.kind === "fill") {
      if (!deps.textModel) return finish("blocked", `Typing into “${action.label}” needs the text model, which is not set up here.`);
      if (!await fresh(page, action)) {
        if (++changedPages > MAX_CHANGED_PAGES) return finish("blocked", PAGE_KEPT_CHANGING);
        page = await observe();
        continue;
      }
      const context: FieldContext = {
        goal,
        field: { label: action.label, ...(action.role ? { role: action.role } : {}), ...(action.value ? { value: action.value } : {}) },
        page: { title: page.title, text: page.text.slice(0, 6000) },
        recent_actions: history.slice(-6).map(({ action: done, text: typed }) => ({ action: done, text: typed })),
      };
      const written = await fieldText(deps.textModel, context, { timeoutMs: limit.textMs, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
      if (!written.ok) {
        return finish("blocked", written.reason === "missing"
          ? `The goal does not say what to type into “${action.label}”.`
          : `The text model did not answer for “${action.label}”.`);
      }
      text = written.text;
    }

    const before = page;
    try {
      await press(before, action);
      if (action.kind === "fill" && text !== undefined) {
        await evaluate(selectAllScript(action.node!));
        await insertText(text);
      }
    } catch (error) {
      if (!(error instanceof StalePage)) throw error;
      if (++changedPages > MAX_CHANGED_PAGES) return finish("blocked", PAGE_KEPT_CHANGING);
      page = await observe();
      continue;
    }
    changedPages = 0;
    history.push({ action: action.label, kind: action.kind, text: text ?? null, page_changed: null });
    if (action.kind !== "wait") await evaluate(settleScript(action)).catch(() => undefined);
    page = await observe();
    history.at(-1)!.page_changed = page.marker !== before.marker;
    await step(action.kind, action.label, page, text);
    if (action.kind === "click" && !PAGING.test(action.label) && history.slice(-6).filter((item) => item.kind === action.kind && item.action === action.label).length >= 3) {
      return finish("blocked", `Pressing “${action.label}” again and again did not move the goal forward.`);
    }
    const recent = history.slice(-3);
    if (recent.length === 3 && recent.every((item) => item.page_changed === false && item.kind !== "wait")) {
      return finish("blocked", "The last three actions changed nothing on the page.");
    }
  }
}
