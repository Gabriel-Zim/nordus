import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
import { StoreProvider, type Bot, type Message } from "@/state/store";
import { ApprovalCard } from "./ApprovalCard";
import {
  PendingApprovalActions,
  spokenApprovalPrompt,
  type Pending,
} from "./PendingApproval";

function commandApproval(answered?: "allow" | "deny"): { message: Message; pending: Pending } {
  const message: Message = {
    id: "approval-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: "pnpm test",
      options: ["Allow", "Deny"],
      answered,
      requestId: "approval-request",
      tool: "Bash",
    },
  };
  return {
    message,
    pending: {
      message,
      requestId: "approval-request",
      tool: "Bash",
      allowKey: "Bash:pnpm test",
      detail: "pnpm test",
    },
  };
}

afterEach(() => {
  setLocale("en");
});

describe("German approval cards", () => {
  it("renders a pending command approval in German", () => {
    setLocale("de");
    const { message } = commandApproval();

    const markup = renderToStaticMarkup(createElement(ApprovalCard, {
      bot: { name: "Mochi" } as Bot,
      message,
    }));

    expect(markup).toContain('aria-label="Ausstehende Freigabe"');
    expect(markup).toContain('aria-label="Details zur Freigabe prüfen"');
    expect(markup).toContain("pnpm test");
  });

  it("renders a denied command approval in German as a record without answers", () => {
    setLocale("de");
    const { message } = commandApproval("deny");

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));

    expect(markup).toContain('data-approval-row="settled"');
    expect(markup).not.toContain("<button");
  });

  it("speaks a command approval in German", () => {
    setLocale("de");
    const { pending } = commandApproval();

    expect(spokenApprovalPrompt(pending, "Mochi")).toBe(
      "Mochi möchte eine Änderung vornehmen. pnpm test. Soll ich das erlauben?",
    );
  });

  it("renders command approval actions in German", () => {
    setLocale("de");
    const { pending } = commandApproval();

    const markup = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(PendingApprovalActions, {
        pending,
        threadId: "thread-1",
        bot: { id: "bot-1", name: "Mochi" } as Bot,
        onCancelTurn: () => undefined,
      }),
    ));

    expect(markup).toContain("Ausführung abbrechen");
    expect(markup).toContain("Ablehnen");
    expect(markup).toContain("Immer erlauben");
    expect(markup).toContain("Einmal erlauben");
    expect(markup).toContain("Bei Mochi nicht mehr nach Bash:pnpm test fragen");
  });
});

/**
 * pt-BR needs another shape for skill approvals: "Should I {action} it?" takes an enclitic pronoun, so the action
 * strings carry it ("atualizá-la").
 */
function skillUpdateApproval(): Pending {
  const message: Message = {
    id: "skill-update-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Atualizar a habilidade \"lancar-despesa\"?",
      subtitle: "Lança uma despesa no portal da empresa.",
      options: ["Atualizar", "Negar"],
      requestId: "skill-update-request",
      tool: "update_skill",
      skillRequest: {
        version: 1,
        requestId: "skill-update-request",
        botId: "bot-1",
        threadId: "thread-1",
        stagedId: "staged-update",
        action: "update",
        name: "lancar-despesa",
        gist: "Lança uma despesa no portal da empresa.",
        warnings: [],
        createdAt: 1,
      },
    },
  };
  return {
    message,
    requestId: "skill-update-request",
    tool: "update_skill",
    detail: message.card!.subtitle,
  };
}

describe("Brazilian Portuguese approval cards", () => {
  it("renders a pending command approval in Brazilian Portuguese", () => {
    setLocale("pt-BR");
    const { message } = commandApproval();

    const markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(ApprovalCard, {
      bot: { name: "Mochi", id: "bot-1" } as Bot,
      message,
      threadId: "thread-1",
    })));
    const row = markup.slice(0, markup.indexOf('id="approval-details-'));

    expect(row).toContain("Mochi pede sua aprovação");
    expect(row).toContain("Quero rodar um comando no computador.");
    expect(row).toContain(">Permitir uma vez</button>");
    expect(row).toContain(">Negar</button>");
    expect(row).toContain("Ver detalhes");
    expect(row).not.toContain("pnpm test");
    expect(markup.slice(markup.indexOf('id="approval-details-'))).toContain("pnpm test");
    expect(markup).toContain('aria-label="Detalhes da aprovação para revisar"');
  });

  it("renders a denied command approval in Brazilian Portuguese as a small record", () => {
    setLocale("pt-BR");
    const { message } = commandApproval("deny");

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));

    expect(markup).toContain("Você negou");
    expect(markup).toContain("Quero rodar um comando no computador.");
    expect(markup).not.toContain("pnpm test");
  });

  it("speaks a command approval in Brazilian Portuguese", () => {
    setLocale("pt-BR");
    const { pending } = commandApproval();

    expect(spokenApprovalPrompt(pending, "Mochi")).toBe(
      "Mochi quer rodar um comando no computador. Devo permitir?",
    );
  });

  it("speaks a skill approval with the pronoun attached to the verb", () => {
    setLocale("pt-BR");

    expect(spokenApprovalPrompt(skillUpdateApproval(), "Mochi")).toBe(
      "Mochi pergunta: Atualizar a habilidade \"lancar-despesa\"? "
        + "Confira a habilidade na tela. Devo atualizá-la?",
    );
  });

  it("names the task release in Brazilian Portuguese, on the card and in its record", () => {
    setLocale("pt-BR");
    const { message, pending } = commandApproval();
    const actions = renderToStaticMarkup(createElement(StoreProvider, null, createElement(PendingApprovalActions, {
      pending: { ...pending, canReleaseTask: true },
      threadId: "thread-1",
      bot: { id: "bot-1", name: "Mochi" } as Bot,
    })));
    expect(actions).toContain(">Permitir tudo nesta tarefa</button>");
    expect(actions).toContain('title="Libera este pedido e todos os próximos desta tarefa até ela terminar"');
    expect(actions.indexOf("Permitir uma vez")).toBeLessThan(actions.indexOf("Permitir tudo nesta tarefa"));
    expect(actions.indexOf("Permitir tudo nesta tarefa")).toBeLessThan(actions.indexOf("Sempre permitir"));
    const record = renderToStaticMarkup(createElement(ApprovalCard, {
      message: { ...message, card: { ...message.card!, answered: "allow", releasedTask: true } },
    }));
    expect(record).toContain("Liberado nesta tarefa");
    expect(record).not.toContain("Você permitiu");
  });

  it("renders command approval actions in Brazilian Portuguese", () => {
    setLocale("pt-BR");
    const { pending } = commandApproval();

    const markup = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(PendingApprovalActions, {
        pending,
        threadId: "thread-1",
        bot: { id: "bot-1", name: "Mochi" } as Bot,
        onCancelTurn: () => undefined,
      }),
    ));

    expect(markup).toContain("Cancelar execução");
    expect(markup).toContain("Negar");
    expect(markup).toContain("Sempre permitir");
    expect(markup).toContain("Permitir uma vez");
    expect(markup).toContain("Não perguntar mais a Mochi sobre Bash:pnpm test");
  });
});
