// Política global de erro do processo: erros soltos são registrados e o servidor continua vivo,
// exceto falta de memória e tempestade de exceções, que encerram de forma graciosa.

export const UNCAUGHT_STORM_LIMIT = 5;
export const UNCAUGHT_STORM_WINDOW_MS = 60_000;
export const STORM_EXIT_CODE = 70;

export interface ProcessErrorPolicyDeps {
  now: () => number;
  logError: (...args: unknown[]) => void;
  /** Encerramento gracioso; recebe o código de saída desejado. */
  exit: (code: number) => void;
  limit?: number;
  windowMs?: number;
}

export interface ProcessErrorPolicy {
  onUnhandledRejection: (reason: unknown) => void;
  onUncaughtException: (error: unknown) => void;
}

function describe(error: unknown): unknown {
  return error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : error;
}

function isOutOfMemory(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ERR_OUT_OF_MEMORY";
}

export function createProcessErrorPolicy(deps: ProcessErrorPolicyDeps): ProcessErrorPolicy {
  const limit = deps.limit ?? UNCAUGHT_STORM_LIMIT;
  const windowMs = deps.windowMs ?? UNCAUGHT_STORM_WINDOW_MS;
  let stamps: number[] = [];
  let exiting = false;

  const leave = (code: number): void => {
    if (exiting) return;
    exiting = true;
    deps.exit(code);
  };

  return {
    onUnhandledRejection(reason) {
      deps.logError("process: unhandledRejection (servidor segue de pé)", describe(reason));
      if (isOutOfMemory(reason)) leave(1);
    },
    onUncaughtException(error) {
      deps.logError("process: uncaughtException (servidor segue de pé)", describe(error));
      if (isOutOfMemory(error)) {
        deps.logError("process: falta de memória, encerrando");
        leave(1);
        return;
      }
      const now = deps.now();
      stamps = stamps.filter((t) => now - t < windowMs);
      stamps.push(now);
      if (stamps.length >= limit) {
        deps.logError(`process: ${stamps.length} exceções em ${Math.round(windowMs / 1000)} s, encerrando`);
        leave(STORM_EXIT_CODE);
      }
    },
  };
}
