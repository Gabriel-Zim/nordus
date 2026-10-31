import { cn } from "@/lib/cn";
import type { AppsFilter } from "../PluginsPanel";
import { McpServersPanel } from "../McpServersPanel";
import { OAuthAppsPanel } from "../OAuthAppsPanel";
import { AdvancedDisclosure } from "./AdvancedDisclosure";

/** Custom connections and the platform apps' client settings. In the advanced view they sit in the page as they
 *  always did; in the simple view the same panels wait behind "Advanced", closed. */
export function AppsAdvancedSection({ simple, filter, search, addRequest, forceOpen, onOAuthMatches, onMcpMatches }: {
  simple: boolean;
  filter: AppsFilter;
  search: string;
  addRequest: number;
  /** A deep link to the technical list opens the disclosure at once. */
  forceOpen: boolean;
  onOAuthMatches: (count: number) => void;
  onMcpMatches: (count: number) => void;
}) {
  const oauth = (simple || filter === "mcp") && <OAuthAppsPanel query={search} onMatches={onOAuthMatches} />;
  const list = (
    <div className={cn(!simple && filter === "all" && !search.trim() && "mt-8 border-t border-hairline/30 pt-6", !simple && filter === "mcp" && "pt-1")}>
      <McpServersPanel embedded hideWhop={filter === "all"} query={search} onMatches={onMcpMatches} addRequest={addRequest} />
    </div>
  );
  if (!simple) return <>{oauth}{filter !== "connected" && list}</>;
  if (filter === "connected") return null;
  return <AdvancedDisclosure openSignal={addRequest} defaultOpen={forceOpen}>{oauth}{list}</AdvancedDisclosure>;
}
