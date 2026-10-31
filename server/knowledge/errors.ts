import type { PathProblem } from "../../shared/knowledge-path.ts";

export type KnowledgeErrorCode =
  | "bad_path"
  | "bad_title"
  | "bad_input"
  | "not_found"
  | "forbidden"
  | "exists"
  | "title_taken"
  | "path_taken"
  | "conflict"
  | "too_large"
  | "full"
  | "limit"
  | "no_space";

const STATUS: Readonly<Record<KnowledgeErrorCode, number>> = {
  bad_path: 400,
  bad_title: 400,
  bad_input: 400,
  not_found: 404,
  forbidden: 403,
  exists: 409,
  title_taken: 409,
  path_taken: 409,
  conflict: 409,
  too_large: 413,
  full: 507,
  limit: 413,
  no_space: 403,
};

export class KnowledgeError extends Error {
  readonly status: number;
  readonly code: KnowledgeErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(code: KnowledgeErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "KnowledgeError";
    this.code = code;
    this.status = STATUS[code];
    if (detail) this.detail = detail;
  }
}

export function isKnowledgeError(error: unknown): error is KnowledgeError {
  return error instanceof KnowledgeError;
}

const PATH_MESSAGES: Readonly<Record<PathProblem, string>> = {
  type: "the path must be text",
  empty: "the path is empty",
  dot: "the path cannot contain . or ..",
  character: "the path has a character that is not allowed",
  "segment-length": "a name in the path is too long",
  length: "the path is too long",
  depth: "the path has too many folders",
};

export function badPath(problem: PathProblem): KnowledgeError {
  return new KnowledgeError("bad_path", PATH_MESSAGES[problem], { problem });
}
