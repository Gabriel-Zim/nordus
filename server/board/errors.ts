export class BoardError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BoardError";
    this.status = status;
  }
}

export const notFound = (what: "task" | "mission" = "task") =>
  new BoardError(404, what === "task" ? "Essa tarefa não existe." : "Essa missão não existe.");
export const forbidden = (message = "Você não pode fazer isso.") => new BoardError(403, message);
export const invalid = (message: string) => new BoardError(400, message);
