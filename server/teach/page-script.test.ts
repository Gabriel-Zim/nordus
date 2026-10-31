// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sanitizeTeachEvent } from "../../shared/teach.ts";
import { TEACH_BINDING, TEACH_PAGE_SCRIPT } from "./page-script.ts";

const PASSWORD = "Sup3r-Secreta-9981";
const OTP = "482913";
let sent: Array<Record<string, unknown>>;
// O projeto do servidor nao tem os tipos de DOM (e nao deve ganhar so por causa deste teste): happy-dom entra pelo ambiente.
interface Field { value: string; dispatchEvent(event: unknown): boolean }
interface Dom {
  window: Record<string, unknown> & { Event: new (type: string, init?: object) => unknown; MouseEvent: new (type: string, init?: object) => unknown; FocusEvent: new (type: string) => unknown };
  document: { body: { innerHTML: string }; getElementById(id: string): Field | null };
}
const dom = globalThis as unknown as Dom;
const { window, document } = new Proxy({} as Dom, { get: (_t, key: keyof Dom) => dom[key] });

function load(): void {
  window[TEACH_BINDING] = (payload: string) => { sent.push(JSON.parse(payload)); };
  (globalThis as unknown as { CSS?: { escape(s: string): string } }).CSS ??= { escape: (s: string) => s };
  // eslint-disable-next-line no-new-func
  new Function(TEACH_PAGE_SCRIPT.replace(/^\(\(\) => \{/, "(() => {").replace(/\}\)\(\)$/, "})()")).call(window);
}

// O script liga os ouvintes uma vez por pagina (documento), como no navegador.
beforeAll(() => { sent = []; load(); });
beforeEach(() => {
  sent = [];
  document.body.innerHTML = `
    <label for="u">E-mail</label><input id="u" type="text">
    <label for="p">Senha</label><input id="p" type="password">
    <input id="c" type="text" autocomplete="one-time-code" placeholder="Código">
    <button id="go">Entrar</button>`;
});

describe("script injetado na pagina", () => {
  it("manda digitacao comum com valor e clique", () => {
    const user = document.getElementById("u")!;
    user.value = "eu@exemplo.com";
    user.dispatchEvent(new window.Event("change", { bubbles: true }));
    document.getElementById("go")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(sent[0]).toMatchObject({ t: "type", value: "eu@exemplo.com", inputType: "text" });
    expect(sent[1]).toMatchObject({ t: "click", text: "Entrar", role: "button" });
  });

  it("o valor de senha e de codigo nunca sai da pagina", () => {
    for (const [id, value] of [["p", PASSWORD], ["c", OTP]] as const) {
      const input = document.getElementById(id)!;
      input.value = value;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      input.dispatchEvent(new window.FocusEvent("blur"));
    }
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const everything = JSON.stringify(sent);
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(OTP);
    expect(sent.find((e) => e.selector === "#p")).toMatchObject({ t: "type", secret: "password" });
    expect(sent.find((e) => e.selector === "#c")).toMatchObject({ t: "type", secret: "code" });
    // e o servidor, mesmo se a pagina mentisse, descartaria o valor
    expect(sanitizeTeachEvent({ t: "type", field: "Senha", selector: "#p", inputType: "password", value: PASSWORD }, "https://a.com/")).toMatchObject({ kind: "type-secret" });
  });

  it("e idempotente", () => {
    load();
    const user = document.getElementById("u")!;
    user.value = "x";
    user.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(sent.filter((e) => e.t === "type")).toHaveLength(1);
  });
});
