// Nordus: ensinar uma tarefa (frente G). Grava o que a pessoa faz no Chrome do robo (por CDP) como passos.
// Valores de senha, codigo de uso unico e cartao nunca chegam aqui: a pagina nao os manda e sanitizeTeachEvent confere de novo.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  isCriticalLabel, sanitizeTeachEvent, sanitizeTeachUrl, TEACH_MAX_MS, TEACH_MAX_STEPS,
  type TeachAction, type TeachRecording, type TeachStatus, type TeachStep,
} from "../../shared/teach.ts";
import { connectCdpEvents, type CdpEvents } from "./cdp.ts";
import { TEACH_BINDING, TEACH_PAGE_SCRIPT } from "./page-script.ts";

export interface TeachRecorderDeps {
  /** Endereco do DevTools do Chrome do robo; tenta por ~20 s porque o navegador pode estar subindo. */
  cdpUrl(botId: string): Promise<string | null>;
  connect?(url: string): Promise<CdpEvents>;
  /** DATA_DIR/teach */
  dir: string;
  now?(): number;
  /** Avisa a interface a cada mudanca. */
  onChange?(botId: string, status: TeachStatus): void;
  /** Quando a gravacao para sozinha (limite de passos ou de tempo): quem usa resume e pergunta como no "parar". */
  onAutoStop?(botId: string, recording: TeachRecording): void;
  maxSteps?: number;
  maxMs?: number;
}

export class TeachError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface PageState { targetId: string; url: string; title: string }

interface Live {
  botId: string;
  threadId: string;
  owner: string;
  recId: string;
  startedAt: number;
  steps: TeachStep[];
  state: "starting" | "recording";
  cdp: CdpEvents | null;
  off: (() => void) | null;
  sessions: Map<string, PageState>;
  attaching: Set<string>;
  lastSession: string | null;
  noShotUntil: number;
  work: Set<Promise<unknown>>;
  timer: ReturnType<typeof setTimeout> | null;
  ready: Promise<void>;
  error?: string;
  closed: boolean;
}

const KEEP_RECORDINGS = 5;
const SHOT_FOLDER_RE = /^[\w-]{1,64}$/;

export class TeachRecorder {
  private live = new Map<string, Live>();
  private summarizing = new Map<string, TeachRecording>();
  private last = new Map<string, string>(); // botId -> recId da gravacao mais recente (para miniaturas)
  private deps: TeachRecorderDeps;

  constructor(deps: TeachRecorderDeps) { this.deps = deps; }

  private now(): number { return (this.deps.now ?? Date.now)(); }
  private get maxSteps(): number { return this.deps.maxSteps ?? TEACH_MAX_STEPS; }
  private get maxMs(): number { return this.deps.maxMs ?? TEACH_MAX_MS; }

  status(botId: string): TeachStatus {
    const live = this.live.get(botId);
    if (live) {
      return {
        recording: true, startedAt: live.startedAt, threadId: live.threadId, steps: live.steps, state: live.state,
        ...(live.error ? { error: live.error } : {}),
      };
    }
    const done = this.summarizing.get(botId);
    if (done) return { recording: false, startedAt: done.startedAt, threadId: done.threadId, steps: done.steps, state: "summarizing" };
    return { recording: false, steps: [] };
  }

  private emit(botId: string): void {
    try { this.deps.onChange?.(botId, this.status(botId)); } catch {}
  }

  /** Comeca a gravar. Responde logo com state "starting"; a conexao com o Chrome acontece em seguida (veja whenReady). */
  async start(input: { botId: string; threadId: string; owner: string }): Promise<TeachStatus> {
    const { botId, threadId, owner } = input;
    if (this.live.has(botId)) throw new TeachError(409, "Já estou gravando uma tarefa neste robô.");
    if (this.summarizing.has(botId)) throw new TeachError(409, "Ainda estou pensando na tarefa anterior.");
    const live: Live = {
      botId, threadId, owner, recId: randomUUID().replace(/-/g, "").slice(0, 16), startedAt: this.now(), steps: [], state: "starting",
      cdp: null, off: null, sessions: new Map(), attaching: new Set(), lastSession: null, noShotUntil: 0, work: new Set(),
      timer: null, ready: Promise.resolve(), closed: false,
    };
    this.live.set(botId, live);
    live.ready = this.connect(live).catch((error: unknown) => {
      if (live.closed) return;
      const message = error instanceof TeachError ? error.message : "Não consegui ligar a gravação no navegador. Abra o navegador do robô e tente de novo.";
      this.teardown(live);
      this.live.delete(botId);
      this.deps.onChange?.(botId, { recording: false, steps: [], error: message });
    });
    this.emit(botId);
    return this.status(botId);
  }

  /** Resolve quando a conexao com o navegador terminou (ou falhou). */
  whenReady(botId: string): Promise<void> { return this.live.get(botId)?.ready ?? Promise.resolve(); }

  /** Resolve quando os prints pendentes terminaram. */
  async idle(botId: string): Promise<void> {
    const live = this.live.get(botId);
    if (live) await Promise.allSettled(live.work);
  }

  private async connect(live: Live): Promise<void> {
    const url = await this.deps.cdpUrl(live.botId);
    if (live.closed) return;
    if (!url) throw new TeachError(409, "Não achei o navegador deste robô. Abra o painel do navegador e tente de novo.");
    const cdp = await (this.deps.connect ?? ((u: string) => connectCdpEvents(u)))(url);
    if (live.closed) { cdp.close(); return; }
    live.cdp = cdp;
    live.off = cdp.on((method, params, sessionId) => { void this.onEvent(live, method, params, sessionId); });
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const listed = await cdp.send("Target.getTargets").catch(() => ({}));
    const infos = Array.isArray((listed as { targetInfos?: unknown }).targetInfos) ? (listed as { targetInfos: Array<Record<string, unknown>> }).targetInfos : [];
    for (const info of infos) if (info.type === "page") await this.attach(live, info);
    live.state = "recording";
    live.timer = setTimeout(() => this.limit(live), this.maxMs);
    live.timer.unref?.();
    this.emit(live.botId);
  }

  private async attach(live: Live, info: Record<string, unknown>): Promise<void> {
    const targetId = typeof info.targetId === "string" ? info.targetId : "";
    if (!targetId || live.closed || live.attaching.has(targetId)) return;
    live.attaching.add(targetId);
    const cdp = live.cdp;
    if (!cdp) return;
    try {
      const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const sessionId = typeof attached.sessionId === "string" ? attached.sessionId : "";
      if (!sessionId) return;
      live.sessions.set(sessionId, { targetId, url: typeof info.url === "string" ? info.url : "", title: typeof info.title === "string" ? info.title : "" });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Runtime.addBinding", { name: TEACH_BINDING }, sessionId);
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TEACH_PAGE_SCRIPT }, sessionId);
      await cdp.send("Runtime.evaluate", { expression: TEACH_PAGE_SCRIPT }, sessionId);
    } catch {
      // Uma aba que nao deixa anexar (ex.: pagina interna) nao derruba a gravacao.
    }
  }

  private async onEvent(live: Live, method: string, params: Record<string, unknown>, sessionId?: string): Promise<void> {
    if (live.closed) return;
    if (method === "Target.targetCreated") {
      const info = params.targetInfo as Record<string, unknown> | undefined;
      if (info && info.type === "page") await this.attach(live, info);
      return;
    }
    if (method === "Target.targetInfoChanged") {
      const info = params.targetInfo as Record<string, unknown> | undefined;
      if (!info) return;
      for (const page of live.sessions.values()) {
        if (page.targetId === info.targetId) {
          if (typeof info.url === "string") page.url = info.url;
          if (typeof info.title === "string") page.title = info.title;
        }
      }
      return;
    }
    if (method === "Target.detachedFromTarget" || method === "Target.targetDestroyed") {
      const gone = typeof params.sessionId === "string" ? params.sessionId : null;
      if (gone) live.sessions.delete(gone);
      else for (const [id, page] of live.sessions) if (page.targetId === params.targetId) live.sessions.delete(id);
      return;
    }
    if (!sessionId || live.state !== "recording") return;
    const page = live.sessions.get(sessionId);
    if (!page) return;
    if (method === "Page.frameNavigated") {
      const frame = params.frame as { parentId?: string; url?: string } | undefined;
      if (!frame || frame.parentId || typeof frame.url !== "string") return;
      page.url = frame.url;
      if (!/^https?:/i.test(frame.url)) return;
      const url = sanitizeTeachUrl(frame.url);
      const prev = live.steps[live.steps.length - 1];
      if (prev && prev.action.kind === "navigate" && prev.action.url === url) return;
      this.record(live, sessionId, page, { kind: "navigate", url });
      return;
    }
    if (method === "Runtime.bindingCalled" && params.name === TEACH_BINDING && typeof params.payload === "string") {
      let raw: unknown;
      try { raw = JSON.parse(params.payload); } catch { return; }
      const action = sanitizeTeachEvent(raw, page.url);
      if (action) this.record(live, sessionId, page, action);
    }
  }

  private record(live: Live, sessionId: string, page: PageState, action: TeachAction): void {
    if (live.closed || !live.cdp) return;
    const url = sanitizeTeachUrl(page.url);
    if (live.lastSession && live.lastSession !== sessionId) {
      this.push(live, { kind: "tab", url, title: page.title }, page, url, null);
    }
    live.lastSession = sessionId;
    const at = this.now();
    const last = live.steps[live.steps.length - 1];
    // Digitacao seguida no mesmo campo vira um passo so (fica o ultimo valor); rolagem seguida soma.
    if (last && action.kind === "type" && last.action.kind === "type" && last.action.selector === action.selector && last.action.field === action.field) {
      last.action = action; last.at = at; last.url = url; last.title = page.title;
      this.afterPush(live, last, sessionId);
      return;
    }
    if (last && action.kind === "type-secret" && last.action.kind === "type-secret" && last.action.selector === action.selector) {
      last.at = at;
      this.emit(live.botId);
      return;
    }
    if (last && action.kind === "scroll" && last.action.kind === "scroll" && last.action.direction === action.direction) {
      last.action = { ...last.action, amount: last.action.amount + action.amount }; last.at = at;
      this.emit(live.botId);
      return;
    }
    this.push(live, action, page, url, sessionId);
  }

  private push(live: Live, action: TeachAction, page: PageState, url: string, sessionId: string | null): void {
    if (live.steps.length >= this.maxSteps) return;
    const step: TeachStep = { n: live.steps.length + 1, at: this.now(), url, title: page.title, action };
    if ((action.kind === "click" && isCriticalLabel(action.text)) || (action.kind === "key" && action.key === "Enter" && !!action.field && isCriticalLabel(action.field))) {
      step.critical = true;
    }
    live.steps.push(step);
    if (action.kind === "type-secret" && (action.secret === "code" || action.secret === "card")) live.noShotUntil = this.now() + 60_000;
    this.afterPush(live, step, sessionId);
    if (live.steps.length >= this.maxSteps) this.limit(live);
  }

  private afterPush(live: Live, step: TeachStep, sessionId: string | null): void {
    // Sem print em passo secreto, nem por 60 s depois de codigo ou cartao (como BrowserSteps.signIn).
    const quiet = step.action.kind === "type-secret" || this.now() < live.noShotUntil;
    if (!quiet && sessionId) this.shoot(live, step, sessionId);
    this.emit(live.botId);
  }

  private shoot(live: Live, step: TeachStep, sessionId: string): void {
    const cdp = live.cdp;
    if (!cdp) return;
    const job = (async () => {
      try {
        const metrics = await cdp.send("Page.getLayoutMetrics", {}, sessionId);
        const vp = metrics.cssVisualViewport as { clientWidth?: number; clientHeight?: number } | undefined;
        const width = Math.max(1, Math.round(vp?.clientWidth ?? 1280));
        const height = Math.max(1, Math.round(vp?.clientHeight ?? 720));
        const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 40, clip: { x: 0, y: 0, width, height, scale: 0.35 } }, sessionId);
        if (typeof shot.data !== "string" || live.closed || !this.live.has(live.botId)) return;
        // Se o passo virou secreto ou o relogio de silencio comecou enquanto isso, descarta.
        if (step.action.kind === "type-secret" || this.now() < live.noShotUntil) return;
        const folder = join(this.deps.dir, live.botId, live.recId);
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        writeFileSync(join(folder, `${step.n}.jpg`), Buffer.from(shot.data, "base64"), { mode: 0o600 });
        step.shot = `${step.n}.jpg`;
        this.emit(live.botId);
      } catch {
        // Falha de print nao derruba a gravacao.
      }
    })();
    live.work.add(job);
    void job.finally(() => live.work.delete(job));
  }

  private limit(live: Live): void {
    if (live.closed || this.live.get(live.botId) !== live) return;
    void this.finish(live).then((recording) => {
      if (recording) this.deps.onAutoStop?.(live.botId, recording);
    });
  }

  private teardown(live: Live): void {
    live.closed = true;
    if (live.timer) clearTimeout(live.timer);
    live.off?.();
    try { live.cdp?.close(); } catch {}
  }

  private async finish(live: Live): Promise<TeachRecording> {
    // Deixa terminar os prints que ja estavam a caminho, sem esperar para sempre.
    await Promise.race([Promise.allSettled(live.work), new Promise((resolve) => setTimeout(resolve, 3000).unref?.())]);
    const recording: TeachRecording = {
      id: live.recId, botId: live.botId, threadId: live.threadId, startedAt: live.startedAt, endedAt: this.now(), steps: live.steps,
      ...(live.steps.length >= this.maxSteps || this.now() - live.startedAt >= this.maxMs ? { truncated: true } : {}),
    };
    this.teardown(live);
    this.live.delete(live.botId);
    this.last.set(live.botId, live.recId);
    try {
      const folder = join(this.deps.dir, live.botId, live.recId);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(join(folder, "recording.json"), JSON.stringify(recording, null, 2), { mode: 0o600 });
      this.prune(live.botId);
    } catch {}
    this.summarizing.set(live.botId, recording);
    this.emit(live.botId);
    return recording;
  }

  /** Para de gravar. Quem chama deve chamar done(botId) quando o resumo terminar. Null quando nao grava. */
  async stop(botId: string, owner: string, opts: { admin?: boolean } = {}): Promise<{ recording: TeachRecording } | null> {
    const live = this.live.get(botId);
    if (!live) return null;
    if (live.owner !== owner && !opts.admin) throw new TeachError(403, "Só quem começou a gravar pode parar.");
    return { recording: await this.finish(live) };
  }

  /** Marca o fim do resumo: some o "pensando" da interface. */
  done(botId: string): void {
    if (this.summarizing.delete(botId)) this.emit(botId);
  }

  cancel(botId: string): void {
    const live = this.live.get(botId);
    if (live) {
      this.teardown(live);
      this.live.delete(botId);
      try { rmSync(join(this.deps.dir, botId, live.recId), { recursive: true, force: true }); } catch {}
    }
    this.summarizing.delete(botId);
    this.emit(botId);
  }

  /** Caminho da miniatura do passo n da gravacao atual ou da ultima, ou null. */
  shotPath(botId: string, n: number): string | null {
    const live = this.live.get(botId);
    const recId = live?.recId ?? this.summarizing.get(botId)?.id ?? this.last.get(botId);
    if (!recId || !SHOT_FOLDER_RE.test(botId) || !SHOT_FOLDER_RE.test(recId) || !Number.isInteger(n) || n < 1 || n > 100_000) return null;
    const path = join(this.deps.dir, botId, recId, `${n}.jpg`);
    try { return statSync(path).isFile() ? path : null; } catch { return null; }
  }

  private prune(botId: string): void {
    try {
      const root = join(this.deps.dir, botId);
      // So as pastas de gravacao (a lista taught.json mora no mesmo lugar e fica).
      const folders = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ name: e.name, at: statSync(join(root, e.name)).mtimeMs }));
      folders.sort((a, b) => b.at - a.at);
      for (const old of folders.slice(KEEP_RECORDINGS)) rmSync(join(root, old.name), { recursive: true, force: true });
    } catch {}
  }
}
