import { botAvatarUrlSchema } from "./bot-avatar.ts";

export const MAX_PHOTO_URL = 512;

/** Security: a photo address is https only, with no credentials, on one line and bounded. */
export function httpsPhotoUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_PHOTO_URL || /[\s\p{Cc}]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Security: the only addresses given to an `img` for a person are the owner's stored attachment and an https address. */
export function personPhotoUrl(value: unknown): string | undefined {
  return typeof value === "string" && botAvatarUrlSchema.safeParse(value).success ? value : httpsPhotoUrl(value);
}

/** A device paired with a code has no address; holding the admin scope, it is the owner's own browser or phone. */
export function fromOwnerDevice(sender: { email?: string; admin?: boolean } | undefined): boolean {
  return sender?.admin === true && !sender.email?.trim();
}
