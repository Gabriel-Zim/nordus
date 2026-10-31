import { describe, expect, it, vi } from "vitest";

import { browseNote, builtInBrowserBeside, needsResults, planBrowse } from "./first-move.ts";

const model = { baseUrl: "https://text.test/v1", model: "mercury-3", key: "k" };
const answering = (content: unknown) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }))) as unknown as typeof fetch;
const today = new Date("2026-10-20T12:00:00Z");

describe("planBrowse", () => {
  it("plans a results page for a site search", async () => {
    const fetch = answering({ browse: true, url: "https://www.airbnb.com.br/", results: "https://www.airbnb.com.br/s/Chicago/homes?checkin=2026-11-10&checkout=2026-11-14&adults=1", goal: "Search Chicago, Nov 10 to 14, 1 adult, and stop on the results." });
    const plan = await planBrowse(model, "entra no Airbnb e procura uma opção boa pra mim em Chicago de 10 a 14/11, 1 adulto", today, { timeoutMs: 1_000, fetch });
    expect(plan).toMatchObject({ url: "https://www.airbnb.com.br/" });
    expect(plan?.results).toContain("airbnb.com.br/s/Chicago");
    const body = JSON.parse(String((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body));
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ today: "2026-10-20" });
    expect(body.reasoning_effort).toBe("instant");
  });

  it("does not ask the planner about a message with no sign of a website", async () => {
    const fetch = answering({ browse: true, url: "https://example.com", goal: "x" });
    expect(await planBrowse(model, "me ajuda a escrever um e-mail para o cliente", today, { timeoutMs: 1_000, fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts a search at the site's home even when the planner gave the results page", async () => {
    const results = "https://www.airbnb.com.br/s/Chicago/homes?checkin=2026-11-10&checkout=2026-11-14&adults=1";
    const plan = await planBrowse(model, "entra no Airbnb e procura Chicago", today, { timeoutMs: 1_000, fetch: answering({ browse: true, url: results, results, goal: "Search Chicago." }) });
    expect(plan).toMatchObject({ url: "https://www.airbnb.com.br/", results });
  });

  it("starts at the site's home when the planner starts on a results path without a query", async () => {
    const results = "https://www.airbnb.com.br/s/Lisboa/homes?checkin=2026-11-14&checkout=2026-11-18&adults=2";
    const plan = await planBrowse(model, "entra no airbnb e procura Lisboa", today, { timeoutMs: 1_000, fetch: answering({ browse: true, url: "https://www.airbnb.com.br/s/Lisboa/homes", results, goal: "Search Lisbon." }) });
    expect(plan).toMatchObject({ url: "https://www.airbnb.com.br/", results });
  });

  it("falls back to the start page when the results page is missing or unsafe", async () => {
    const plan = await planBrowse(model, "abre o site do booking", today, { timeoutMs: 1_000, fetch: answering({ browse: true, url: "https://www.booking.com/", results: "http://x", goal: "Open it." }) });
    expect(plan?.results).toBe("https://www.booking.com/");
  });

  it("refuses a plan that is not an https page", async () => {
    expect(await planBrowse(model, "abre o site do booking", today, { timeoutMs: 1_000, fetch: answering({ browse: true, url: "javascript:alert(1)", goal: "x" }) })).toBeNull();
    expect(await planBrowse(model, "abre o site do booking", today, { timeoutMs: 1_000, fetch: answering({ browse: false }) })).toBeNull();
  });
  it("tells the bot to answer from the results list without opening listings", () => {
    const note = browseNote({ url: "https://www.booking.com/", results: "https://www.booking.com/searchresults.html?ss=Porto", goal: "Search Porto." }, "Goal met.");
    expect(note).toMatch(/answer now from the results/i);
    expect(note).toMatch(/do not open listings/i);
  });
  it("moves a date the planner wrote in the past to the next year", async () => {
    const results = "https://www.airbnb.com/s/London/homes?checkin=2026-01-08&checkout=2026-01-11&adults=2";
    const plan = await planBrowse(model, "entra no airbnb e procura Londres de 8 a 11 de janeiro", today, { timeoutMs: 1_000, fetch: answering({ browse: true, url: "https://www.airbnb.com/", results, goal: "Search London, January 8 to 11, 2 adults." }) });
    expect(plan?.results).toBe("https://www.airbnb.com/s/London/homes?checkin=2027-01-08&checkout=2027-01-11&adults=2");
  });
});

describe("needsResults", () => {
  const airbnb = { url: "https://www.airbnb.com/", results: "https://www.airbnb.com/s/London/homes?checkin=2027-01-08", goal: "Search London." };
  const booking = { url: "https://www.booking.com/", results: "https://www.booking.com/searchresults.html?ss=Porto", goal: "Search Porto." };
  const stopped = (url: string) => `Stopped: it could not go further on its own. 6.7 s, 15 actions.\n\nThe last three actions changed nothing on the page.\n\nPage: Airbnb · ${url}`;
  it("opens the results page when the pilot stopped short of them", () => {
    expect(needsResults(airbnb, stopped("https://www.airbnb.com/"))).toBe(true);
  });
  it("opens the planned results when the pilot stopped on some other list, like homes nearby", () => {
    expect(needsResults(airbnb, stopped("https://www.airbnb.com/s/homes?location_search=NEARBY"))).toBe(true);
    expect(needsResults(booking, stopped("https://www.booking.com/searchresults.pt-br.html?ss=Porto"))).toBe(true);
  });
  it("keeps the results page the pilot reached when it met the goal there", () => {
    expect(needsResults(booking, "Goal met. 9.0 s, 8 actions.\n\nPage: Booking · https://www.booking.com/searchresults.pt-br.html?ss=Porto")).toBe(false);
  });
  it("opens the results when the pilot called the goal met on the site's home page", () => {
    expect(needsResults(airbnb, "Goal met. 0.3 s, 0 actions.\n\nPage: Airbnb · https://www.airbnb.com/")).toBe(true);
    expect(needsResults(airbnb, "Goal met. 9.0 s, 8 actions.\n\nPage: Airbnb · https://www.airbnb.com/s/London/homes?checkin=2027-01-08")).toBe(false);
  });
  it("needs nothing when there is no other page to open", () => {
    expect(needsResults({ ...booking, results: booking.url }, stopped("https://www.booking.com/"))).toBe(false);
  });
});

describe("builtInBrowserBeside", () => {
  const ask = "entra no airbnb e procura uma opção boa pra mim em Recife";
  const chores = "organiza os arquivos da pasta de entregas";
  it("mounts the fast browser for a browsing request beside a computer the turn picked or pinned by itself", () => {
    expect(builtInBrowserBeside({ computer: undefined, browser: true }, true, ask)).toBe(true);
    expect(builtInBrowserBeside({ computer: "vm", browser: false }, true, ask)).toBe(true);
    expect(builtInBrowserBeside({ computer: "vm", browser: false }, true, chores)).toBe(false);
    expect(builtInBrowserBeside({ computer: undefined, browser: true }, true, chores)).toBe(false);
    expect(builtInBrowserBeside({ computer: undefined, browser: true }, false, chores)).toBe(true);
  });
  it("keeps the browser off when the bot turned its computer and browser off", () => {
    expect(builtInBrowserBeside({ computer: "off", browser: false }, false, ask)).toBe(false);
  });
});
