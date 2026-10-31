import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

const dispatch = vi.fn();
const fixture = vi.hoisted(() => ({ counting: false, values: [] as unknown[], index: 0, api: vi.fn(), track: vi.fn() }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!fixture.counting) return react.useState(initial);
      const index = fixture.index++;
      if (!(index in fixture.values)) fixture.values[index] = initial;
      return [fixture.values[index], (next: unknown) => { fixture.values[index] = next; }];
    },
  };
});
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ dispatch }),
}));
vi.mock("@/lib/analytics", () => ({ track: fixture.track }));

import { SecretRequestCard } from "./SecretRequestCard";

const secretCard = (secret: Record<string, unknown>): Message => ({
  id: "secret-card",
  role: "bot",
  kind: "secret",
  at: 1,
  text: "Securely provide the OpenAI API key.",
  secret: {
    target: "openaiImageApiKey",
    label: "OpenAI API key",
    description: "Generate a key at platform.openai.com. Scout can use it but never read it back.",
    placeholder: "sk-…",
    helpUrl: "https://platform.openai.com/api-keys",
    requestKey: "request-key-1",
    ...secret,
  },
});

const view = (secret: Record<string, unknown>) => renderToStaticMarkup(createElement(SecretRequestCard, {
  botId: "bot-1",
  threadId: "thread-1",
  message: secretCard(secret),
}));

beforeEach(() => {
  vi.stubGlobal("window", {});
  dispatch.mockReset();
});

describe("SecretRequestCard superseded requests", () => {
  it("still offers entry while the newest request is pending", () => {
    const html = view({});
    expect(html).toContain("Save securely");
    expect(html).toContain("never added to chat.");
  });

  it("stops offering entry and names its replacement once superseded", () => {
    const html = view({ superseded: true });
    expect(html).toContain("Superseded");
    expect(html).toContain("replaced by a newer one for the same key");
    expect(html).toContain("Superseded by a newer request");
    expect(html).not.toContain("Save securely");
    expect(html).not.toContain("type=\"password\"");
    expect(html).not.toContain("Not now");
    expect(html).not.toContain("Waiting to resume safely");
  });
});

describe("SecretRequestCard ask card", () => {
  it("waits as a compact ask card with a masked field", () => {
    const html = view({});
    expect(html).toContain('data-ask-card="pending"');
    expect(html).toContain("text-accent-text");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
  });

  it("folds into one line that names the key once it is saved and the bot resumed", () => {
    const html = view({ provided: true, resumed: true });
    expect(html).toContain('data-ask-card="settled"');
    expect(html).toContain("OpenAI API key saved securely");
    expect(html).toContain("Bot resumed without seeing the key");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });

  it("keeps a retry on the line when resuming after the save failed", () => {
    const html = view({ provided: true, error: "The bot could not be resumed." });
    expect(html).toContain('data-ask-card="settled"');
    expect(html).toContain("Try again");
    expect(html).toContain("The bot could not be resumed.");
    expect(html).not.toContain('type="password"');
  });
});

describe("SecretRequestCard key analytics", () => {
  const KEY = "boat_ZZtestSECRET0123456789abcdef";
  type Props = { children?: ReactNode; type?: string; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault(): void }) => void };
  const nodes = (tree: ReactNode): Array<ReactElement<Props>> =>
    Children.toArray(tree).flatMap((child) => isValidElement<Props>(child) ? [child, ...nodes(child.props.children)] : []);
  const card = (target: string) => {
    fixture.counting = true;
    fixture.index = 0;
    try {
      // SecretRequestCard routes to the credential card, a component of its own: render that one directly.
      const root = SecretRequestCard({ botId: "bot-1", threadId: "thread-1", message: secretCard({ target, label: "Key" }) });
      const credential = isValidElement(root) && typeof root.type === "function" ? (root.type as (props: unknown) => ReactNode)(root.props) : root;
      return nodes(credential);
    } finally {
      fixture.counting = false;
    }
  };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  async function submit(target: string, typed = KEY) {
    card(target).find((node) => node.type === "input")!.props.onChange!({ target: { value: typed } });
    card(target).find((node) => node.type === "form")!.props.onSubmit!({ preventDefault: () => {} });
    await flush();
  }

  beforeEach(() => {
    fixture.values = [];
    fixture.api.mockReset();
    fixture.track.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports a Boat key saved over the desktop bridge once, even when only the resume is retried", async () => {
    const setCredential = vi.fn().mockResolvedValue({ box: { configured: true } });
    vi.stubGlobal("window", { ogb: { setCredential } });
    fixture.api.mockRejectedValueOnce(new Error("resume failed")).mockResolvedValueOnce({ ok: true });
    await submit("boxToken");
    card("boxToken").find((node) => node.type === "form")!.props.onSubmit!({ preventDefault: () => {} });
    await flush();
    expect(setCredential).toHaveBeenCalledExactlyOnceWith("boxToken", KEY);
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(fixture.track.mock.calls).toEqual([["api_key_saved", { provider: "boat", via: "chat_request", result: "ok" }]]);
    for (const fragment of [KEY, KEY.slice(0, 6), KEY.slice(-6), String(KEY.length)]) expect(JSON.stringify(fixture.track.mock.calls)).not.toContain(fragment);
  });

  it("reports a Boat key boat.dev refused as rejected", async () => {
    vi.stubGlobal("window", { ogb: { setCredential: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'credential:set': KeyRejected: That doesn't look like a Boat API key")) } });
    await submit("boxToken");
    expect(fixture.track.mock.calls).toEqual([["api_key_saved", { provider: "boat", via: "chat_request", result: "rejected" }]]);
  });

  // Even with the desktop bridge, the 1Password token goes to this server's Logins (which checks it with 1Password),
  // never the bridge's settings-file store: on My Cloud no bridge exists, and the Cloud's Logins is where bots read it.
  it("saves a 1Password token through Logins, never the settings bridge, then resumes the bot", async () => {
    const setCredential = vi.fn();
    vi.stubGlobal("window", { ogb: { setCredential } });
    fixture.api.mockResolvedValueOnce({ onePassword: { connected: true } }).mockResolvedValueOnce({ ok: true });
    await submit("onePasswordToken", "ops_ZZtestSECRET0123456789");
    expect(setCredential).not.toHaveBeenCalled();
    expect(fixture.api.mock.calls[0]).toEqual(["/api/logins/1password", { method: "POST", body: JSON.stringify({ token: "ops_ZZtestSECRET0123456789" }) }]);
    expect(fixture.api.mock.calls[1]![0]).toBe("/api/bots/bot-1/secret-cards/secret-card/provided");
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.track.mock.calls)).not.toContain("ZZtestSECRET");
  });

  it("reports an xAI key saved from chat as unverified: nothing checks it before it is used", async () => {
    fixture.api.mockResolvedValueOnce({ xai: { configured: true } }).mockResolvedValueOnce({ ok: true });
    await submit("xaiApiKey", "xai-ZZtestSECRET0123456789");
    expect(fixture.api.mock.calls[0]).toEqual(["/api/config", { method: "PUT", body: JSON.stringify({ xai: { key: "xai-ZZtestSECRET0123456789" } }) }]);
    expect(fixture.track.mock.calls).toEqual([["api_key_saved", { provider: "xai", via: "chat_request", result: "unverified" }]]);
  });
});

describe("SecretRequestCard for a key asked by variable name", () => {
  const envView = (secret: Record<string, unknown>) => view({
    target: "env",
    envName: "CLOUDFLARE_API_TOKEN",
    envScope: "bot",
    label: "CLOUDFLARE_API_TOKEN",
    description: "Publicar o site no Cloudflare. Fica guardada no servidor só para Scout. Ninguém lê a chave de volta, nem a conversa.",
    placeholder: "Cole a chave aqui",
    helpUrl: "",
    ...secret,
  });

  it("asks in Portuguese through a hidden field that never echoes or autofills", () => {
    const html = envView({});
    expect(html).toContain('data-ask-card="pending"');
    expect(html).toContain("CLOUDFLARE_API_TOKEN");
    expect(html).toContain("Publicar o site no Cloudflare.");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('value=""');
    expect(html).toContain("Salvar com segurança");
    expect(html).toContain("Agora não");
    expect(html).toContain("Não aparece na conversa.");
    expect(html).not.toContain("Where to get this key");
    expect(html).not.toContain("Save securely");
    expect(html).not.toContain("—");
  });

  it("folds into one line naming only the key once saved and resumed", () => {
    const html = envView({ provided: true, resumed: true });
    expect(html).toContain('data-ask-card="settled"');
    expect(html).toContain("Chave CLOUDFLARE_API_TOKEN salva");
    expect(html).toContain("O robô seguiu sem ver a chave");
    expect(html).not.toContain("<input");
  });

  it("stops offering entry once a newer request replaced it", () => {
    const html = envView({ superseded: true });
    expect(html).toContain("Trocado por um pedido mais novo");
    expect(html).not.toContain('type="password"');
  });
});
