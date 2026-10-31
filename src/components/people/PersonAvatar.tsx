import { senderInitials } from "@/lib/message-author";

export function PersonAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent"
    >
      {senderInitials(name)}
    </span>
  );
}
