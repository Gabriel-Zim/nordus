// Security: the invite link is convenience, not a second door; the one-time code still goes to the address itself.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { applyConfig, configOnce } from "@/lib/config-cache";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCopyFeedback } from "@/lib/copy-text";
import { formatUsd, hasFiniteCost } from "@/lib/usage";
import { readMembership, type Membership } from "../lib/membership";
import { sessionOnce, type SessionState } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { parseAddresses, withEntries } from "@/lib/people-join";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/person-roles";
import { readSignInLists, withEntry, withoutEntry, type SignInLists } from "@/lib/sign-in-lists";
import type { PersonRole } from "../../shared/people";
import { JoinLinkField, JoinRequestRow } from "./JoinLinkPanel";
import { usePeopleJoin } from "./usePeopleJoin";
import { Card } from "./SettingsPrimitives";
import { RoleSelect } from "./RoleSelect";

export type Role = PersonRole;

export interface Person {
  entry: string;
  role: Role;
  isDomain: boolean;
  lastSeenAt: number | null;
  devices: number;
  turns: number;
  costUsd: number | null;
  estimated?: boolean;
}

export function inviteLink(base: string, entry: string): string {
  const origin = base.replace(/\/+$/, "");
  return entry.startsWith("@") ? `${origin}/pair` : `${origin}/pair?email=${encodeURIComponent(entry)}`;
}

export function mergePeople(
  lists: SignInLists,
  sessions: Array<{ email?: string; lastSeenAt: number }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null; estimatedUsd?: number | null }>,
): Person[] {
  const people: Person[] = [];
  const seen = new Set<string>();
  const add = (entry: string, role: Role) => {
    const key = entry.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const devices = sessions.filter((session) => session.email?.toLowerCase() === key);
    const month = usage.find((group) => group.key === `user:${key}`);
    people.push({
      entry: key,
      role,
      isDomain: key.startsWith("@"),
      lastSeenAt: devices.length ? Math.max(...devices.map((session) => session.lastSeenAt)) : null,
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
      ...(hasFiniteCost(month?.estimatedUsd) && month.estimatedUsd > 0 ? { estimated: true } : {}),
    });
  };
  for (const entry of lists.admins) add(entry, "admin");
  for (const entry of lists.members) add(entry, "member");
  for (const entry of lists.guests ?? []) add(entry, "guest");
  return people;
}

export function peopleFromSessions(
  sessions: Array<{ email?: string; lastSeenAt: number; scopes?: string[] }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null }>,
): Person[] {
  const byEmail = new Map<string, Array<{ lastSeenAt: number; scopes?: string[] }>>();
  for (const session of sessions) {
    const email = session.email?.trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), session]);
  }
  return [...byEmail.entries()].map(([entry, devices]) => {
    const month = usage.find((group) => group.key === `user:${entry}`);
    return {
      entry,
      role: devices.some((device) => device.scopes?.includes("admin")) ? "admin" : "member",
      isDomain: false,
      lastSeenAt: Math.max(...devices.map((device) => device.lastSeenAt)),
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
    } satisfies Person;
  }).sort((a, b) => (a.role === b.role ? a.entry.localeCompare(b.entry) : a.role === "admin" ? -1 : 1));
}

export function lastSeenLabel(lastSeenAt: number | null, now = Date.now()): string {
  if (lastSeenAt === null) return t("people.never");
  if (now - lastSeenAt < 24 * 60 * 60_000) return t("people.today");
  return new Date(lastSeenAt).toISOString().slice(0, 10);
}

function toggledRole(role: PersonRole): PersonRole {
  return role === "member" ? "admin" : "member";
}

export function PeopleTable({ people, busy, onRole, onRemove, onLink, readOnly = false }: {
  people: Person[];
  busy: boolean;
  onRole: (person: Person, role: Role) => void;
  onRemove: (person: Person) => void;
  onLink: (person: Person) => void;
  readOnly?: boolean;
}) {
  if (people.length === 0) return <p className="text-[13px] text-ink-secondary">{t(readOnly ? "people.portal.empty" : "people.empty")}</p>;
  const columns = "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4";
  return (
    <div className="flex flex-col">
      <div className={cn(columns, "border-b border-hairline/40 pb-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary")}>
        <span>{t("people.colPerson")}</span>
        <span>{t("people.colRole")}</span>
        <span className="text-right">{t("people.colLastSeen")}</span>
        <span className="text-right">{t("people.colMonth")}</span>
        <span />
      </div>
      {people.map((person) => (
        <div key={person.entry} className={cn(columns, "border-b border-hairline/20 py-2 text-[13px]")}>
          <span className="min-w-0">
            <span className="block truncate text-ink">{person.isDomain ? t("people.everyoneAt", { domain: person.entry.slice(1) }) : person.entry}</span>
            {person.devices > 0 && <span className="block text-[11.5px] text-ink-secondary">{t("people.devices", { count: String(person.devices) })}</span>}
          </span>
          <span title={t(ROLE_HINT[person.role])} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", person.role === "admin" ? "bg-accent/15 text-accent" : "bg-control text-ink-secondary")}>
            {t(ROLE_LABEL[person.role])}
          </span>
          <span className="text-right tabular-nums text-ink-secondary">{person.isDomain ? "—" : lastSeenLabel(person.lastSeenAt)}</span>
          <span className="text-right tabular-nums text-ink" title={t("people.turns", { turns: String(person.turns) })}>
            {hasFiniteCost(person.costUsd) ? `${person.estimated ? "~" : ""}${formatUsd(person.costUsd)}` : "—"}
          </span>
          {readOnly ? <span /> : <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[12px]">
            <button type="button" disabled={busy} onClick={() => onLink(person)} aria-label={t("people.link")} title={t("people.link")} className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"><Link2 size={13} /></button>
            <button type="button" disabled={busy} onClick={() => onRole(person, toggledRole(person.role))} title={t(ROLE_HINT[toggledRole(person.role)])} className="text-ink-secondary hover:text-ink disabled:opacity-50">
              {person.role === "member" ? t("people.makeAdmin") : t("people.makeMember")}
            </button>
            {person.role !== "guest" && <button type="button" disabled={busy} onClick={() => onRole(person, "guest")} title={t(ROLE_HINT.guest)} className="text-ink-secondary hover:text-ink disabled:opacity-50">{t("people.makeGuest")}</button>}
            <button type="button" disabled={busy} onClick={() => onRemove(person)} className="text-danger hover:underline disabled:opacity-50">{t("people.remove")}</button>
          </span>}
        </div>
      ))}
    </div>
  );
}

export function CopyLink({ link }: { link: string }) {
  const { state, copy } = useCopyFeedback(link);
  return (
    <div className="mt-3 rounded-lg border border-hairline/40 bg-inset p-3 text-[12.5px]">
      <div className="mb-1 text-ink-secondary">{t("people.link")}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all text-ink">{link}</code>
        <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
          {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
          {t(state === "copied" ? "people.copied" : state === "failed" ? "common.copyFailed" : "people.copy")}
        </button>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.linkHint")}</p>
    </div>
  );
}

export interface WaitingPerson { email: string; name: string | null; firstAt: number }

export function WaitlistBlock({ entries, busy, onRelease, onRemove }: {
  entries: WaitingPerson[];
  busy: boolean;
  onRelease: (entry: WaitingPerson) => void;
  onRemove: (entry: WaitingPerson) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div data-waitlist className="mt-5">
      <h3 className="text-[13px] font-semibold text-ink">{t("people.waitlist.title")}</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.waitlist.hint")}</p>
      <div className="mt-2 flex flex-col">
        {entries.map((entry) => (
          <div key={entry.email} className="flex items-center gap-x-4 border-b border-hairline/20 py-2 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{entry.email}</span>
              {entry.name && <span className="block truncate text-[11.5px] text-ink-secondary">{entry.name}</span>}
            </span>
            <span className="tabular-nums text-ink-secondary" title={t("people.waitlist.requestedAt")}>{new Date(entry.firstAt).toISOString().slice(0, 10)}</span>
            <span className="flex items-center gap-2 text-[12px]">
              <button type="button" disabled={busy} onClick={() => onRelease(entry)} className="text-accent hover:underline disabled:opacity-50">{t("people.waitlist.release")}</button>
              <button type="button" disabled={busy} onClick={() => onRemove(entry)} className="text-danger hover:underline disabled:opacity-50">{t("people.remove")}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PortalPeople({ peopleUrl, people }: { peopleUrl: string | null; people: Person[] }) {
  const noop = () => {};
  return (
    <Card title={t("people.title")} subtitle={t("people.portal.subtitle")}>
      <div data-people-portal className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-secondary">
        <p>{t("people.portal.managed")}</p>
        {peopleUrl && (
          <a
            href={peopleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-fit items-center gap-2 rounded-lg bg-control px-3 py-2 font-medium text-ink hover:bg-control/70"
          >
            {t("people.portal.open")} <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="mt-4">
        <PeopleTable people={people} busy={false} readOnly onRole={noop} onRemove={noop} onLink={noop} />
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.portal.note")}</p>
    </Card>
  );
}

export function PeopleSection() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [lists, setLists] = useState<SignInLists | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [base, setBase] = useState<string>(typeof window !== "undefined" ? window.location.origin : "");
  const [waiting, setWaiting] = useState<WaitingPerson[]>([]);
  const [emailOffered, setEmailOffered] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<PersonRole>("member");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestRoles, setRequestRoles] = useState<Record<string, PersonRole>>({});
  const join = usePeopleJoin();
  const reloadJoin = join.reload;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, sessions, usage, domain, environment, queue] = await Promise.all([
        configOnce(),
        api("/api/auth/sessions").catch(() => ({ sessions: [] })),
        api("/api/usage?groupBy=user").catch(() => ({ groups: [] })),
        api("/api/settings/custom-domain").catch(() => null),
        fetch("/.well-known/nordus/environment").then((res) => (res.ok ? res.json() : null)).catch(() => null),
        api("/api/waitlist").catch(() => ({ entries: [] })),
      ]);
      setWaiting(Array.isArray(queue?.entries) ? queue.entries : []);
      const current = readSignInLists(config);
      const authority = readMembership(config);
      setMembership(authority);
      setLists(current);
      if (authority.authority !== "portal") void reloadJoin();
      const signedIn = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
      const spent = Array.isArray(usage?.groups) ? usage.groups : [];
      setPeople(authority.authority === "portal" ? peopleFromSessions(signedIn, spent) : mergePeople(current, signedIn, spent));
      if (typeof domain?.publicUrl === "string" && domain.publicUrl) setBase(domain.publicUrl);
      setEmailOffered(environment?.capabilities?.emailSignIn === true || environment?.capabilities?.joinByLink === true ? true : environment ? false : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [reloadJoin]);

  useEffect(() => {
    void sessionOnce().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  const save = async (next: SignInLists) => {
    setBusy(true);
    setError(null);
    try {
      applyConfig(await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: next }) }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const dropFromWaitlist = async (email: string) => {
    await api(`/api/waitlist?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    await load();
  };

  const guarded = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    if (!lists || busy) return;
    const { valid, invalid } = parseAddresses(draft);
    if (valid.length === 0) {
      setError(t("remote.signInAccess.invalid"));
      return;
    }
    await save(withEntries(lists, valid, role));
    setDraft(invalid.join(", "));
    if (invalid.length) setError(t("people.inviteInvalid", { entries: invalid.join(", ") }));
    setLink(valid.length === 1 ? inviteLink(base, valid[0]!) : null);
  };

  const decide = async (id: string, decision: { approve: Role } | { reject: true }) => {
    await join.answer(id, decision);
    await load();
  };

  if (!canPairDevices(session)) return null;
  if (membership?.authority === "portal") return <PortalPeople peopleUrl={membership.peopleUrl} people={people} />;
  return (
    <Card title={t("people.title")} subtitle={t("people.subtitle")}>
      {emailOffered === false && <p className="mb-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[12.5px] text-ink-secondary">{t(membership?.pairingCodes === false ? "people.portalSignIn" : "people.notHosted")}</p>}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("people.invitePlaceholder")}
          aria-label={t("people.inviteEmail")}
          disabled={busy}
          className="min-w-[16rem] flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50"
        />
        <RoleSelect value={role} onChange={setRole} label={t("people.colRole")} disabled={busy} />
        <button type="submit" disabled={busy || !draft.trim()} className="ui-button ui-button-primary">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}{t("people.invite")}
        </button>
        <button type="button" onClick={() => void load()} disabled={loading || busy} aria-label={t("people.refresh")} title={t("people.refresh")} className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"><RefreshCw size={13} className={cn(loading && "animate-spin")} /></button>
      </form>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t(ROLE_HINT[role])} {t("people.inviteNote")}</p>
      {link && <CopyLink link={link} />}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-4 rounded-lg border border-hairline/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">{t("people.link")}</span>
          {join.state.link && (
            <span className="flex items-center gap-3 text-[12px]">
              <button type="button" disabled={join.busy} onClick={() => void join.rotate()} className="text-ink-secondary hover:text-ink disabled:opacity-50">{t("people.joinLink.rotate")}</button>
              <button type="button" disabled={join.busy} onClick={() => void join.disable()} className="text-danger hover:underline disabled:opacity-50">{t("people.joinLink.disable")}</button>
            </span>
          )}
        </div>
        {join.state.link ? (
          <JoinLinkField origin={base} link={join.state.link} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[12.5px] text-ink-secondary">{t("people.joinLink.off")}</p>
            <button type="button" disabled={join.busy} onClick={() => void join.rotate()} className="ui-button ui-button-primary">{t("people.joinLink.create")}</button>
          </div>
        )}
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.joinLink.note")}</p>
        {join.error && <p role="alert" className="mt-2 text-[12px] text-danger">{join.error}</p>}
      </div>
      <div className="mt-4">
        <h3 className="mb-1 text-[13px] font-medium text-ink">{t("people.requests.title")}</h3>
        {join.state.requests.length === 0 ? (
          <p className="text-[12.5px] text-ink-secondary">{t("people.requests.empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {join.state.requests.map((request) => {
              const chosen = requestRoles[request.id] ?? "member";
              return (
                <JoinRequestRow
                  key={request.id}
                  request={request}
                  busy={join.busy}
                  role={chosen}
                  onRole={(next) => setRequestRoles((current) => ({ ...current, [request.id]: next }))}
                  onApprove={() => void decide(request.id, { approve: chosen })}
                  onDecline={() => void decide(request.id, { reject: true })}
                />
              );
            })}
          </ul>
        )}
      </div>
      <div className="mt-4">
        <PeopleTable
          people={people}
          busy={busy}
          onRole={(person, next) => { if (lists) void save(withEntry(lists, person.entry, next)); }}
          onRemove={(person) => { if (lists) void save(withoutEntry(lists, person.entry)); }}
          onLink={(person) => setLink(inviteLink(base, person.entry))}
        />
      </div>
      <WaitlistBlock
        entries={waiting}
        busy={busy}
        onRelease={(entry) => {
          if (lists) void guarded(async () => {
            await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: withEntry(lists, entry.email, "member") }) });
            await dropFromWaitlist(entry.email);
          });
        }}
        onRemove={(entry) => { void guarded(() => dropFromWaitlist(entry.email)); }}
      />
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.note")}</p>
    </Card>
  );
}
