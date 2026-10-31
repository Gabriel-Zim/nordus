import type { Bot } from "@/state/store";
import { ModelPicker } from "./ModelPicker";

/**
 * The quiet model switcher in the chat header. It is the same picker the profile uses, so a provider change in a
 * conversation still goes through the usual approval guard; `threadId` keeps the change on this conversation.
 */
export function ChatModelSwitch({ bot, threadId }: { bot: Bot; threadId?: string }) {
  // Phones drive the model from their own sheet; the desktop header keeps the control off that surface.
  if (window.ogb?.remoteClient?.active === true) return null;
  return (
    <div data-chathead-model="" className="shrink-0 [&>div>button]:py-0.5 [&>div>button]:text-[12px]">
      <ModelPicker bot={bot} threadId={threadId} />
    </div>
  );
}
