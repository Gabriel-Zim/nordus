import { act } from "react";

export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

export const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("Nothing to click");
  return act(async () => { (element as HTMLElement).click(); });
};

export function typeInto(field: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!field) throw new Error("No field to type into");
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  return act(async () => { field.dispatchEvent(new Event("input", { bubbles: true })); });
}

export const leave = (field: Element | null) => act(async () => { field?.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });

export const submit = (form: Element | null | undefined) => {
  if (!form) throw new Error("No form to submit");
  return act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
};

export const press = (key: string, target: EventTarget = window) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

export async function choose(trigger: Element | null | undefined, label: string) {
  await click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[data-nordus-select-menu] [role="option"]')].find((node) => node.textContent?.trim() === label);
  if (!option) throw new Error(`No option named "${label}"`);
  await click(option);
}

export const dragAndDrop = async (card: Element | null, column: Element | null) => {
  if (!card || !column) throw new Error("Nothing to drag");
  await act(async () => { card.dispatchEvent(new Event("dragstart", { bubbles: true })); });
  await act(async () => { column.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true })); });
  await act(async () => { column.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true })); });
};

export const textOf = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent?.replace(/\s+/g, " ").trim());
