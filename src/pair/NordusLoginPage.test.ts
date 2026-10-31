import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ effects: [] as EffectCallback[], status: null as unknown }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
  useState: (initial: unknown) => [initial === null ? f.status : initial, () => {}],
}));
vi.mock("./PairPage", () => ({ PairPage: () => "PAIR_PAGE" }));
import { googleStartHref, nativeGoogleSignIn, NordusLoginPage, readLoginStatus, takeLoginRefusalFromLocation } from "./NordusLoginPage";

const takeRefusal = (search: string) => {
  vi.stubGlobal("location", { pathname: "/", search, hash: "" });
  return takeLoginRefusalFromLocation();
};
const render = (props: Parameters<typeof NordusLoginPage>[0] = {}) => renderToStaticMarkup(createElement(NordusLoginPage, props));

let replaced: string[];
beforeEach(() => {
  replaced = [];
  vi.stubGlobal("location", { pathname: "/", search: "", hash: "" });
  vi.stubGlobal("history", { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) });
});

describe("the Nordus sign-in page", () => {
  it("shows the Nordus card with Entrar com Google and nothing from Cloudflare", () => {
    f.status = { google: true };
    const html = render();
    expect(html).toContain("Nordus");
    expect(html).toContain("Entrar com Google");
    expect(html).toContain('href="/auth/google"');
    expect(html).toContain('href="/pair"');
    expect(html.toLowerCase()).not.toContain("cloudflare");
  });

  it("says in plain words why an account was refused", () => {
    f.status = { google: true };
    expect(render({ refusal: "nao_permitido" })).toContain("Esta conta Google não tem acesso à Nordus");
  });

  it("shows a calm waiting list page instead of an error", () => {
    f.status = { google: true };
    const html = render({ refusal: "lista_de_espera" });
    expect(html).toContain("Você está na lista de espera");
    expect(html).toContain("Sua conta Google entrou na lista de espera da Nordus");
    expect(html).toContain("Entrar com outra conta");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("—");
    expect(takeRefusal("?login_erro=lista_de_espera")).toBe("lista_de_espera");
  });

  it("shows the request-sent page for a pending join and carries the invite token to Google", () => {
    f.status = { google: true };
    const html = render({ refusal: "pendente", joinToken: "tok_12345678", returnTo: "/" });
    expect(html).toContain("Pedido enviado");
    expect(html).toContain("Quem administra este espaço precisa aprovar");
    expect(html).not.toContain('role="alert"');
    expect(takeRefusal("?login_erro=pendente")).toBe("pendente");
    expect(render({ joinToken: "tok_12345678", returnTo: "/" })).toContain('href="/auth/google?convite=tok_12345678"');
    expect(googleStartHref("/sala/1", "", "tok_12345678")).toBe("/auth/google?voltar=%2Fsala%2F1&amp;convite=tok_12345678".replace("&amp;", "&"));
  });

  it("falls back to the pairing page while Google sign-in is off", () => {
    f.status = { google: false };
    expect(render()).toBe("PAIR_PAGE");
  });

  it("comes back to the page the person opened", () => {
    expect(googleStartHref("/", "")).toBe("/auth/google");
    expect(googleStartHref("/sala/1", "?a=b")).toBe("/auth/google?voltar=%2Fsala%2F1%3Fa%3Db");
  });

  it("takes the refusal off the address bar and maps unknown values to a generic one", () => {
    vi.stubGlobal("location", { pathname: "/", search: "?login_erro=nao_permitido&x=1", hash: "" });
    expect(takeLoginRefusalFromLocation()).toBe("nao_permitido");
    expect(replaced).toEqual(["/?x=1"]);
    vi.stubGlobal("location", { pathname: "/", search: "?login_erro=<script>", hash: "" });
    expect(takeLoginRefusalFromLocation()).toBe("falhou");
    vi.stubGlobal("location", { pathname: "/", search: "", hash: "" });
    expect(takeLoginRefusalFromLocation()).toBeNull();
  });

  it("reads the status and treats an unreachable server as off", async () => {
    expect(await readLoginStatus(vi.fn().mockResolvedValue({ ok: true, json: async () => ({ google: true }) }))).toEqual({ google: true });
    expect(await readLoginStatus(vi.fn().mockRejectedValue(new Error("offline")))).toEqual({ google: false });
  });

  it("hands the click to a native shell only when it offers the hook", () => {
    vi.stubGlobal("window", {});
    expect(nativeGoogleSignIn()).toBeNull();
    const hook = async () => {};
    vi.stubGlobal("window", { nordusNative: { signInWithGoogle: hook } });
    expect(nativeGoogleSignIn()).toBe(hook);
  });
});
