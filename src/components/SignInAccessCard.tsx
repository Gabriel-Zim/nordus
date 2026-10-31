import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { applyConfig, configOnce } from "@/lib/config-cache";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/person-roles";
import { normalizeAccessEntry, readSignInLists, withEntry, withoutEntry, type SignInLists } from "@/lib/sign-in-lists";
import { api } from "@/state/store";
import type { PersonRole } from "../../shared/people";
import { sessionOnce, type SessionState } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { Card } from "./SettingsPrimitives";

export { normalizeAccessEntry, withEntry, withoutEntry, type SignInLists } from "@/lib/sign-in-lists";

const input = "w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent-border";
const button = "ui-button ui-button-primary";
const quiet = "ui-button ui-button-sm";

export function SignInAccessCard() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [lists, setLists] = useState<SignInLists | null>(null);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<PersonRole>("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  async function load() {
    try {
      const config = await configOnce();
      setLists(readSignInLists(config));
      const domain = await api("/api/settings/custom-domain").catch(() => null);
      setPublicUrl(typeof domain?.publicUrl === "string" ? domain.publicUrl : null);
    } catch (e) {
      setError(t("remote.signInAccess.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  useEffect(() => {
    void sessionOnce().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, []);

  if (!canPairDevices(session) || !lists) return null;

  async function save(next: SignInLists) {
    setBusy(true);
    setError(null);
    try {
      applyConfig(await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: next }) }));
      setLists(next);
    } catch (e) {
      setError(t("remote.signInAccess.error", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const entry = normalizeAccessEntry(draft);
    if (!entry || !lists) {
      setError(t("remote.signInAccess.invalid"));
      return;
    }
    await save(withEntry(lists, entry, role));
    setDraft("");
  }

  const rows = [
    ...lists.admins.map((entry) => ({ entry, role: "admin" as const })),
    ...lists.members.map((entry) => ({ entry, role: "member" as const })),
    ...(lists.guests ?? []).map((entry) => ({ entry, role: "guest" as const })),
  ];

  return (
    <Card title={t("remote.signInAccess.title")} subtitle={t("remote.signInAccess.subtitle")}>
      {publicUrl ? (
        <p className="mt-2 text-[12.5px] text-ink-secondary">
          {t("remote.signInAccess.link")} <code className="select-all text-ink">{publicUrl}/pair</code>
        </p>
      ) : null}
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("remote.signInAccess.placeholder")}
          autoComplete="off"
          spellCheck={false}
          className={`${input} max-w-[320px] flex-1`}
          aria-label={t("remote.signInAccess.placeholder")}
        />
        <label className="flex items-center gap-1.5 text-[13px] text-ink">
          <input type="radio" name="signin-role" checked={role === "admin"} onChange={() => setRole("admin")} />
          {t("remote.serverPairing.scope.admin")}
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-ink">
          <input type="radio" name="signin-role" checked={role === "member"} onChange={() => setRole("member")} />
          {t("remote.serverPairing.scope.client")}
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-ink">
          <input type="radio" name="signin-role" checked={role === "guest"} onChange={() => setRole("guest")} />
          {t(ROLE_LABEL.guest)}
        </label>
        <button type="submit" disabled={busy || !draft.trim()} className={button}>
          {t("remote.signInAccess.add")}
        </button>
      </form>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t(ROLE_HINT[role])}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-ink-secondary">{t("remote.signInAccess.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline/40">
          {rows.map(({ entry, role: entryRole }) => (
            <li key={entry} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span className="text-ink">
                {entry}
                <span className="text-ink-secondary"> · {entryRole === "admin" ? t("remote.serverPairing.scope.admin") : entryRole === "guest" ? t(ROLE_LABEL.guest) : t("remote.serverPairing.scope.client")}</span>
              </span>
              <button type="button" disabled={busy} onClick={() => void save(withoutEntry(lists, entry))} className={quiet}>
                {t("remote.signInAccess.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-secondary">{t("remote.signInAccess.note")}</p>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </Card>
  );
}
