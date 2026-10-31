// The agents catalog's Drive and Wiki tools and the internal route behind each. A bot works in its own space only: the
// route, not the tool list, decides what it may read or write.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

const KNOWLEDGE_TOOL_ROUTES: Readonly<Record<string, string>> = {
  drive_save: "drive-save",
  drive_list: "drive-list",
  drive_read: "drive-read",
  wiki_search: "wiki-search",
  wiki_read: "wiki-read",
  wiki_write: "wiki-write",
};
export const KNOWLEDGE_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(KNOWLEDGE_TOOL_ROUTES));

export async function callKnowledgeTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(`/api/internal/knowledge/${KNOWLEDGE_TOOL_ROUTES[name]}`, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? JSON.stringify(body)) } : { text: String(body.error ?? "That did not work. Try again shortly."), isError: true };
}

export const KNOWLEDGE_TOOL_DEFINITIONS = [
  {
    name: "drive_save",
    description: "Save a file to the Drive of your space. Saving to an existing path keeps the old content as a version. Give text, or from_file (a file in your working folder).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1000, description: "Drive path, such as Reports/2026-10/summary.md. With from_file, a path ending in / keeps the file's name." },
        text: { type: "string", description: "The text to save as the file." },
        from_file: { type: "string", minLength: 1, description: "A file in your working folder to save." },
        note: { type: "string", maxLength: 200, description: "A short note on this version." },
      },
      required: ["path"],
    },
  },
  {
    name: "drive_list",
    description: "List a Drive folder of your space: names, sizes, versions and who saved each file. Omit path for the top.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { path: { type: "string", maxLength: 1000, description: "The folder, such as Reports/2026-10." } },
    },
  },
  {
    name: "drive_read",
    description: "Read a file from the Drive of your space. Text, Markdown and CSV come back as text; anything else, or as \"file\", is copied into your working folder and its path returned.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1000, description: "The file's Drive path." },
        version: { type: "integer", minimum: 1, description: "An earlier version. Omit for the latest." },
        as: { type: "string", enum: ["auto", "text", "file"], description: "auto (default), text, or file for a copy in your working folder." },
      },
      required: ["path"],
    },
  },
  {
    name: "wiki_search",
    description: "Search the Wiki of your space (linked Markdown pages) by words in the title, tags, folder or text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 1, maxLength: 200, description: "Words to look for." } },
      required: ["query"],
    },
  },
  {
    name: "wiki_read",
    description: "Read a Wiki page by title (or Folder/Title): its text, tags, the pages that link to it and links that lead nowhere yet.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { title: { type: "string", minLength: 1, maxLength: 300, description: "The page title, or Folder/Title." } },
      required: ["title"],
    },
  },
  {
    name: "wiki_write",
    description: "Create a Wiki page, or save a new version of the page with this title. Markdown; link pages with [[Page]], [[Page|label]] or [[Page#section]]. History is kept and the page shows you as the author.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 300, description: "The page title, or Folder/Title to put it in a folder." },
        content: { type: "string", description: "The whole page, in Markdown." },
        summary: { type: "string", maxLength: 200, description: "A short note on what changed." },
      },
      required: ["title", "content"],
    },
  },
];
