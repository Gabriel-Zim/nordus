import { describe, expect, it } from "vitest";
import { isModelUnavailableError, isTechnicalError, plainErrorLine } from "./plain-error";
import { registrySaveFailure } from "../../shared/registry-save-failure";

describe("plainErrorLine", () => {
  it.each([
    ["Failed to fetch", "Couldn't reach Nordus right now. Check the internet connection and try again."],
    ["turn interrupted — Nordus AI restarted", "Nordus AI restarted mid-reply. Check what was already done before asking again."],
    ["turn interrupted — the Company connection changed", "The reply was interrupted by a settings change. Ask again if you still need it."],
    ["turn interrupted — provider settings changed", "The reply was interrupted by a settings change. Ask again if you still need it."],
    ["NetworkError when attempting to fetch resource.", "Couldn't reach Nordus right now. Check the internet connection and try again."],
    ["The operation was aborted due to timeout", "That took too long. Try again."],
    ["502 Bad Gateway", "Something went wrong on the other end. Try again."],
    ["500 Internal Server Error", "Something went wrong on the other end. Try again."],
    ["404 Not Found", "That couldn't be found. It may have been removed."],
    ["413 Payload Too Large", "That's too large to send."],
    ["429 Too Many Requests", "Too many requests right now. Wait a moment, then try again."],
    ['API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "The service is busy right now. Try again in a moment."],
    ["API Error: 529 Overloaded. This is a server-side issue, usually temporary.", "Overloaded. This is a server-side issue, usually temporary."],
    ["API Error: 400 Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required.", "Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required."],
    ["OpenRouter HTTP 404: model qwen-9 not found", "model qwen-9 not found"],
    ["HTTP 503", "The service is busy right now. Try again in a moment."],
    ["HTTP 502 Bad Gateway", "Something went wrong on the other end. Try again."],
    ["upstream HTTP 503 Service Unavailable", "The service is busy right now. Try again in a moment."],
    ["EACCES: permission denied, open '/Users/sam/notes.md'", "This computer didn't allow that. Check the file or folder permissions, then try again."],
    ["upstream HTTP 401: {\"error\":{\"message\":\"invalid x-api-key\"}}", "Access was refused. Check the sign-in, then try again."],
    ["read ECONNRESET", "The connection dropped. Try again."],
    ["TypeError: Cannot read properties of undefined (reading 'id')", "Something went wrong. Try again."],
    ["Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON", "Something went wrong. Try again."],
    ["claude exited 3 before result: fake-claude: simulated crash before result", "Something went wrong. Try again."],
    ["rate_limited", "Too many requests right now. Wait a moment, then try again."],
    ["Error\n    at fetchBots (store.tsx:12:3)", "Something went wrong. Try again."],
    [
      "There's an issue with the selected model (claude-opus-4-1). It may not exist or you may not have access to it. Run --model to pick a different model.",
      "That model isn't available right now. Choose another model.",
    ],
    [
      "THERE’S AN ISSUE WITH THE SELECTED MODEL (GPT-5.6). IT MAY NOT EXIST OR YOU MAY NOT HAVE ACCESS TO IT. RUN --MODEL TO PICK A DIFFERENT MODEL.",
      "That model isn't available right now. Choose another model.",
    ],
    [
      "API Error: 400 There's an issue with the selected model (x). It may not exist or you may not have access to it. Run --model to pick a different model.",
      "That model isn't available right now. Choose another model.",
    ],
    [
      "There is an issue with the selected model (qwen-9). It may not exist or you may not have access to it.",
      "That model isn't available right now. Choose another model.",
    ],
  ])("reads %j as a plain line", (raw, line) => {
    expect(plainErrorLine(raw)).toBe(line);
  });

  it.each([
    "Clipboard has no image",
    "Add your key in Settings → API keys",
    "Not logged in · Please run /login",
    "rate limited",
    "Your Pro plan includes 2 cloud computers at once. Delete one to start another.",
    "ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded)",
    "no activity for 10 minutes — the turn was stopped",
    "The server returned HTTP 503. Wait for the scheduled maintenance to finish, then try again.",
    "Couldn't undo that change.",
    registrySaveFailure("the thread switch", "bots.json", "EPERM"),
    registrySaveFailure("the thread deletion", "groups.json", "ENOSPC"),
    "The engine said: There's an issue with the selected model (x). Run --model to pick a different model.",
    "There's an issue with the selected model (x).",
    "",
  ])("keeps a sentence a person can read: %j", (raw) => {
    expect(isTechnicalError(raw)).toBe(false);
    expect(plainErrorLine(raw)).toBeUndefined();
  });
});

describe("isModelUnavailableError", () => {
  it("matches the provider sentence whole, and never a normal message that quotes it", () => {
    const provider = "There's an issue with the selected model (x). It may not exist or you may not have access to it. Run --model to pick a different model.";
    expect(isModelUnavailableError(provider)).toBe(true);
    expect(isModelUnavailableError(`  ${provider}  `)).toBe(true);
    expect(isModelUnavailableError(`The engine said: ${provider}`)).toBe(false);
    expect(isModelUnavailableError("There's an issue with the selected model (x).")).toBe(false);
  });
});
