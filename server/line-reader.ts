// Leitor de linhas com teto: junta pedaços de um fluxo (stdout de CLI, socket) em linhas completas
// sem concatenar string a cada chegada, e trata uma linha sem fim como erro em vez de estouro de memória.

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const MIB = 1024 * 1024;

export const DEFAULT_CLI_MAX_LINE_BYTES = 64 * MIB;
export const DEFAULT_BROKER_MAX_LINE_BYTES = 4 * MIB; // um pedido de Write legítimo passa de 1 MiB (teste do claude.test.ts usa 1,35 MB)

/** `NORDUS_MAX_LINE_BYTES` (inteiro positivo) vale para os dois tetos; sem ele, usa `fallbackBytes` (se dado) ou o padrão de cada um. */
export function maxLineBytesFor(kind: "cli" | "broker", env: NodeJS.ProcessEnv = process.env, fallbackBytes?: number): number {
  const raw = env.NORDUS_MAX_LINE_BYTES;
  const override = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(override) && override > 0) return override;
  return fallbackBytes ?? (kind === "broker" ? DEFAULT_BROKER_MAX_LINE_BYTES : DEFAULT_CLI_MAX_LINE_BYTES);
}

function formatMb(bytes: number): string {
  const mb = bytes / MIB;
  return Number.isInteger(mb) || mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
}

export class LineTooLongError extends Error {
  readonly bytes: number;
  readonly limitBytes: number;
  constructor(bytes: number, limitBytes: number, source = "A CLI") {
    super(`${source} enviou uma linha de ${formatMb(bytes)} MB, acima do limite de ${formatMb(limitBytes)} MB`);
    this.name = "LineTooLongError";
    this.bytes = bytes;
    this.limitBytes = limitBytes;
  }
}

export interface LineReaderOptions {
  maxLineBytes: number;
  /** Retornar `true` encerra a leitura: o que chegar depois é ignorado. */
  onLine: (line: string) => boolean | void;
  onOverflow?: (error: LineTooLongError) => void;
  /** Quem enviou, para a mensagem de erro (padrão: "A CLI"). */
  source?: string;
}

export class LineReader {
  /** Verdadeiro depois que uma linha passou do teto; tudo que chega depois é ignorado. */
  overflowed = false;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private stopped = false;
  private readonly opts: LineReaderOptions;

  constructor(opts: LineReaderOptions) {
    this.opts = opts;
  }

  push(chunk: Buffer | string): void {
    if (this.overflowed || this.stopped) return;
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    let start = 0;
    while (start < buf.length) {
      const nl = buf.indexOf(NEWLINE, start);
      if (nl === -1) {
        this.append(buf.subarray(start));
        return;
      }
      const tailBytes = nl - start;
      if (this.pendingBytes + tailBytes > this.opts.maxLineBytes) {
        this.overflow(this.pendingBytes + tailBytes);
        return;
      }
      const piece = buf.subarray(start, nl);
      const line = this.pending.length ? Buffer.concat([...this.pending, piece]) : piece;
      this.pending = [];
      this.pendingBytes = 0;
      start = nl + 1;
      if (this.emit(line)) return;
    }
  }

  /** Fim do fluxo: emite o resto pendente, se houver. */
  end(): void {
    if (this.overflowed || this.stopped || this.pendingBytes === 0) return;
    const line = Buffer.concat(this.pending);
    this.pending = [];
    this.pendingBytes = 0;
    this.emit(line);
  }

  private append(piece: Buffer): void {
    if (this.pendingBytes + piece.length > this.opts.maxLineBytes) {
      this.overflow(this.pendingBytes + piece.length);
      return;
    }
    // Copia: o Buffer recebido pode ser reaproveitado por quem o produziu.
    this.pending.push(Buffer.from(piece));
    this.pendingBytes += piece.length;
  }

  private emit(line: Buffer): boolean {
    const end = line.length > 0 && line[line.length - 1] === CARRIAGE_RETURN ? line.length - 1 : line.length;
    if (this.opts.onLine(line.toString("utf8", 0, end)) === true) this.stopped = true;
    return this.stopped;
  }

  private overflow(bytes: number): void {
    this.overflowed = true;
    this.pending = [];
    this.pendingBytes = 0;
    this.opts.onOverflow?.(new LineTooLongError(bytes, this.opts.maxLineBytes, this.opts.source));
  }
}
