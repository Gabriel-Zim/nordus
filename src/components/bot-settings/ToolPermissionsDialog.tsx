import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import { friendlyToolName } from "@/lib/human-tool";
import { api, type Bot } from "@/state/store";

interface ToolRow {
  selector: string;
  name: string;
  description: string;
  sensitive: boolean;
  blocked: boolean;
}

interface ToolsResponse {
  groups: Array<{ id: string; tools: ToolRow[] }>;
  servers: Array<{ id: string; blockedAll: boolean; blocked: string[] }>;
  deny: string[];
}

const SENSITIVE = /(?:^|_)(?:publish|post|tweet|broadcast|delete|remove|destroy|drop|purge|erase|trash|wipe|deploy|rollback|merge|release|pay|payment|payout|charge|refund|transfer|purchase|buy)(?:_|$)/i;

export function useBotTools(botId: string, reloadKey: unknown) {
  const [tools, setTools] = useState<ToolsResponse | null>(null);
  useEffect(() => {
    let alive = true;
    void api<ToolsResponse>(`/api/bots/${botId}/tools`).then((next) => { if (alive) setTools(next); }).catch(() => undefined);
    return () => { alive = false; };
  }, [botId, reloadKey]);
  return tools;
}

/** "80 de 82 ferramentas": every listed tool minus the blocked ones. */
export function toolCount(tools: ToolsResponse | null): { on: number; total: number } | null {
  if (!tools) return null;
  const list = tools.groups.flatMap((group) => group.tools);
  return { on: list.filter((tool) => !tool.blocked).length, total: list.length };
}

export function ToolPermissionsDialog({ bot, onClose, onSaved }: { bot: Bot; onClose: () => void; onSaved: () => void }) {
  const tools = useBotTools(bot.id, null);
  const [deny, setDeny] = useState<Set<string> | null>(null);
  const [probed, setProbed] = useState<Record<string, ToolRow[] | string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useMemo(() => deny ?? new Set(tools?.deny ?? []), [deny, tools]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (selector: string) => {
    const next = new Set(current);
    if (next.has(selector)) next.delete(selector);
    else next.add(selector);
    setDeny(next);
  };

  const probe = async (server: string) => {
    setProbed((prev) => ({ ...prev, [server]: "…" }));
    try {
      const result = await api<{ ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string }>(`/api/mcp/servers/${server}/test`, { method: "POST", body: "{}" });
      setProbed((prev) => ({
        ...prev,
        [server]: result.ok && result.tools
          ? result.tools.map((tool) => ({ selector: `mcp:${server}:${tool.name}`, name: tool.name, description: tool.description ?? "", sensitive: SENSITIVE.test(tool.name), blocked: false }))
          : result.error ?? t("toolPerms.probeFailed"),
      }));
    } catch (cause) {
      setProbed((prev) => ({ ...prev, [server]: cause instanceof Error ? cause.message : t("toolPerms.probeFailed") }));
    }
  };

  const save = async () => {
    if (!deny || saving) return;
    setSaving(true);
    setError(null);
    try {
      const allow = bot.toolScope?.allow;
      const toolScope = deny.size === 0 && !allow ? null : { ...(allow ? { allow } : {}), deny: [...deny] };
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ toolScope }) });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const row = (tool: ToolRow) => {
    const blocked = current.has(tool.selector);
    return (
      <li key={tool.selector} data-tool-row={tool.selector} className="flex items-start gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("text-[13px] font-medium", blocked ? "text-ink-tertiary line-through" : "text-ink")}>{tFromServer(`toolName.${tool.name}`, undefined) || friendlyToolName(tool.name)}</span>
            {tool.sensitive && (
              <span className="inline-flex items-center gap-1 rounded-[7px] bg-warning/10 px-1.5 py-px text-[10.5px] font-medium text-warning">
                <ShieldAlert size={11} aria-hidden="true" />{t("toolPerms.alwaysAsks")}
              </span>
            )}
          </div>
          {(tFromServer(`toolDesc.${tool.name}`, undefined) || tool.description) && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-tertiary">{tFromServer(`toolDesc.${tool.name}`, undefined) || tool.description}</p>
          )}
        </div>
        <button
          type="button"
          aria-pressed={blocked}
          onClick={() => toggle(tool.selector)}
          className={cn(
            "shrink-0 rounded-[10px] px-2.5 py-1 text-[12px] font-medium transition-colors",
            blocked ? "bg-danger/15 text-danger" : "bg-white/[0.06] text-ink-secondary hover:text-ink",
          )}
        >
          {blocked ? t("toolPerms.blocked") : t("toolPerms.block")}
        </button>
      </li>
    );
  };

  const appTools = tools?.groups.flatMap((group) => group.tools) ?? [];
  const on = appTools.filter((tool) => !current.has(tool.selector)).length;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={t("toolPerms.title", { name: bot.name })}
        data-tool-permissions=""
        className="flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-[560px] flex-col overflow-hidden rounded-[18px] border border-white/10 shadow-2xl"
        style={{ background: "var(--color-menu)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{t("toolPerms.title", { name: bot.name })}</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-secondary">
              {tools ? t("toolPerms.count", { on, total: appTools.length }) : t("common.checking")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("toolPerms.close")} className="rounded-[10px] p-1.5 text-ink-secondary hover:bg-white/[0.06] hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          <p className="py-2 text-[12px] leading-relaxed text-ink-tertiary">{t("toolPerms.sensitiveNote")}</p>
          <h3 className="pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{t("toolPerms.appGroup")}</h3>
          <ul className="divide-y divide-white/[0.06]">{appTools.map(row)}</ul>
          {tools?.servers.map((server) => {
            const listed = probed[server.id];
            const all = `mcp:${server.id}:*`;
            return (
              <section key={server.id} className="mt-3">
                <div className="flex items-center justify-between gap-2 pt-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{server.id}</h3>
                  <div className="flex gap-1.5">
                    {!Array.isArray(listed) && (
                      <button type="button" onClick={() => void probe(server.id)} className="rounded-[10px] bg-white/[0.06] px-2 py-0.5 text-[11.5px] text-ink-secondary hover:text-ink">
                        {listed === "…" ? t("common.checking") : t("toolPerms.showTools")}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-pressed={current.has(all)}
                      onClick={() => toggle(all)}
                      className={cn("rounded-[10px] px-2 py-0.5 text-[11.5px]", current.has(all) ? "bg-danger/15 text-danger" : "bg-white/[0.06] text-ink-secondary hover:text-ink")}
                    >
                      {current.has(all) ? t("toolPerms.serverBlocked") : t("toolPerms.blockServer")}
                    </button>
                  </div>
                </div>
                {typeof listed === "string" && listed !== "…" && <p className="py-1 text-[11.5px] text-danger">{listed}</p>}
                {Array.isArray(listed) && <ul className="divide-y divide-white/[0.06]">{listed.map(row)}</ul>}
              </section>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          {error && <p role="alert" className="mr-auto text-[12px] text-danger">{error}</p>}
          <button type="button" onClick={onClose} className="rounded-[10px] px-3 py-1.5 text-[13px] text-ink-secondary hover:text-ink">{t("toolPerms.cancel")}</button>
          <button
            type="button"
            disabled={!deny || saving || Boolean(bot.busy)}
            onClick={() => void save()}
            className="rounded-[10px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {t("toolPerms.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
