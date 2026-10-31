import type { ReactNode } from "react";

/** A quiet, centred line for what happened around the conversation, never a card. */
export function SimpleSystemLine({ children, "data-simple-event": event }: { children: ReactNode; "data-simple-event"?: string }) {
  return (
    <div data-simple-event={event} className="flex w-full justify-center py-0.5">
      <span className="min-w-0 rounded-full bg-inset/40 px-2.5 py-0.5 text-center text-[11.5px] leading-5 text-ink-tertiary">{children}</span>
    </div>
  );
}
