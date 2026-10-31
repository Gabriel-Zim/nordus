import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { File as FileIcon, FileImage, FileSpreadsheet, FileText, Folder, LoaderCircle, Music, Video } from "lucide-react";

import type { DriveItem, KnowledgeSpaceId, WireKnowledgeActor, WireKnowledgeSpace } from "../../../shared/knowledge";
import { cn } from "@/lib/cn";
import { driveApi } from "@/lib/knowledge-api";
import { actorInitials, chooseSpace, rememberedSpace, rememberSpace, spaceLabel } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { BotAvatar, InitialsAvatar } from "../Avatar";
import { useCaptionChrome } from "../DesktopCapabilities";

/** The spaces this person may open, and the one they are looking at. The choice is kept, so Drive and Wiki open on the same one. */
export function useKnowledgeSpaces() {
  const [spaces, setSpaces] = useState<WireKnowledgeSpace[] | null>(null);
  const [space, setSpaceState] = useState<KnowledgeSpaceId | null>(null);
  const [admin, setAdmin] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = useRef<string | null>(rememberedSpace());

  const load = useCallback(() => {
    setFailed(false);
    driveApi.access().then(
      (reply) => {
        setSpaces(reply.spaces);
        setAdmin(reply.admin);
        setSpaceState(chooseSpace(reply.spaces, chosen.current));
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const setSpace = useCallback((id: KnowledgeSpaceId) => {
    chosen.current = id;
    rememberSpace(id);
    setSpaceState(id);
  }, []);
  return { spaces, space, setSpace, admin, failed, reload: load };
}

export function SpaceSwitcher({ spaces, space, onChange }: { spaces: readonly WireKnowledgeSpace[]; space: KnowledgeSpaceId | null; onChange: (id: KnowledgeSpaceId) => void }) {
  if (spaces.length < 2 || !space) return null;
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
      <span>{t("drive.space.label")}</span>
      <select
        value={space}
        onChange={(event) => onChange(event.target.value as KnowledgeSpaceId)}
        className="ui-button ui-button-md max-w-[14rem] cursor-pointer appearance-none truncate bg-control pe-6"
        aria-label={t("drive.space.pick")}
      >
        {spaces.map((entry) => (
          <option key={entry.id} value={entry.id}>{spaceLabel(entry)}</option>
        ))}
      </select>
    </label>
  );
}

/** The page frame both screens share: a title row that also drags the window, then the body. */
export function KnowledgeShell({ icon, title, subtitle, actions, children }: { icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const { dragProps } = useCaptionChrome();
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <header {...dragProps} className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline/40 px-6 py-3.5 max-md:pl-14">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-ink-secondary" aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-semibold leading-6">{title}</h1>
            {subtitle && <p className="hidden truncate text-[12.5px] text-ink-secondary lg:block">{subtitle}</p>}
          </div>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}

/** The agent's own face when we know it, initials otherwise, then the name. */
export function ActorBadge({ actor, size = 18, className }: { actor: WireKnowledgeActor; size?: number; className?: string }) {
  const { state } = useStore();
  const bot = actor.kind === "bot" ? state.bots.find((candidate) => candidate.id === actor.id) : undefined;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {bot ? <BotAvatar bot={bot} size={size} /> : <InitialsAvatar initials={actorInitials(actor)} size={size} />}
      <span className="truncate">{actor.name}</span>
    </span>
  );
}

export function FileGlyph({ item, size = 17 }: { item: DriveItem; size?: number }) {
  const className = "shrink-0 text-ink-secondary";
  if (item.kind === "folder") return <Folder size={size} className="shrink-0 text-accent" aria-hidden="true" />;
  switch (item.preview) {
    case "image": return <FileImage size={size} className={className} aria-hidden="true" />;
    case "csv": return <FileSpreadsheet size={size} className={className} aria-hidden="true" />;
    case "markdown":
    case "text":
    case "pdf": return <FileText size={size} className={className} aria-hidden="true" />;
    case "audio": return <Music size={size} className={className} aria-hidden="true" />;
    case "video": return <Video size={size} className={className} aria-hidden="true" />;
    default: return <FileIcon size={size} className={className} aria-hidden="true" />;
  }
}

export function Loading({ label = t("drive.loading") }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-10 text-[13px] text-ink-secondary">
      <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 p-6 text-[13.5px]">
      <p className="text-danger">{text}</p>
      {onRetry && <button type="button" className="ui-button ui-button-md" onClick={onRetry}>{t("chat.retry")}</button>}
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-10 text-center">
      <p className="text-[15px] font-medium">{t("drive.noAccess.title")}</p>
      <p className="max-w-sm text-[13px] text-ink-secondary">{t("drive.noAccess.body")}</p>
    </div>
  );
}
