import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { ROBO_CORPOS, corpoPadrao } from "@/lib/robo-estado";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";
import { withLook } from "./RobotLookEditor";

const BODY_NAME = { peito: "Chest", cintura: "Waist", capsula: "Capsule", robusto: "Sturdy", esfera: "Sphere" } as const;

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Nordus",
    title: "Nordus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function renderCard(bot: Bot) {
  return renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(BotProfileAvatarCard, {
        bot,
        activeState: "idle",
        mascotMotion: null,
        onPatch: vi.fn(),
      }),
    ),
  );
}

const pressed = (markup: string, label: string) =>
  markup.match(new RegExp(`aria-pressed="(true|false)"[^>]*aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`))?.[1];

describe("BotProfileAvatarCard robot look", () => {
  it("offers the five robot bodies, pressing the one drawn from the bot id by default", () => {
    const markup = renderCard(makeBot());
    expect(markup).toContain(">Body<");
    for (const corpo of ROBO_CORPOS) {
      expect(pressed(markup, BODY_NAME[corpo])).toBe(corpo === corpoPadrao("bot-1") ? "true" : "false");
    }
    expect(markup).not.toContain("Back to default");
  });

  it("reflects a chosen body, shell and light, with a free colour beside the palette", () => {
    const markup = renderCard(makeBot({ robot: { body: "esfera", shell: "#e6e8ec", light: "#123456" } }));
    expect(pressed(markup, BODY_NAME.esfera)).toBe("true");
    expect(pressed(markup, "Shell color #e6e8ec")).toBe("true");
    expect(pressed(markup, "Shell color #3a3a3a")).toBe("false");
    expect(pressed(markup, "Same as the accent color")).toBe("false");
    expect(markup).toMatch(/aria-label="Light color: Any color"[^>]*value="#123456"/);
    expect(markup).toContain("--nb-casca:#e6e8ec");
    expect(markup).toContain("Back to default");
  });

  it("dresses the feminine robot instead of offering bodies", () => {
    const markup = renderCard(makeBot({ robot: { gender: "f" } }));
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Feminine</);
    expect(markup).not.toContain(">Body<");
    expect(markup).toContain(">Dress color<");
    expect(pressed(markup, "Same as the lights")).toBe("true");
  });

  it("keeps the graphite shell and the accent lights as the defaults", () => {
    const markup = renderCard(makeBot());
    expect(pressed(markup, "Shell color #3a3a3a")).toBe("true");
    expect(pressed(markup, "Same as the accent color")).toBe("true");
    expect(markup).not.toContain(">Dress color<");
  });

  it("offers zoom and drag framing for a custom image", () => {
    const markup = renderCard(makeBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 1.5,
    }));
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the robot", () => {
    const markup = renderCard(makeBot());
    expect(markup).not.toContain('aria-label="Zoom avatar"');
  });

  it("hides the robot editor for every flat crop", () => {
    for (const crop of ["circle", "rounded", "square"] as const) {
      const markup = renderCard(makeBot({ avatarCrop: crop }));
      expect(markup).not.toContain("data-robot-look");
      expect(markup).not.toContain(">Body<");
    }
  });
});

describe("withLook", () => {
  it("drops cleared fields and turns an empty look back into the defaults", () => {
    expect(withLook(null, { shell: "#e6e8ec" })).toEqual({ shell: "#e6e8ec" });
    expect(withLook({ shell: "#e6e8ec", light: "#ff9a18" }, { light: undefined })).toEqual({ shell: "#e6e8ec" });
    expect(withLook({ dress: "#5a2030" }, { dress: undefined })).toBeNull();
  });
});
