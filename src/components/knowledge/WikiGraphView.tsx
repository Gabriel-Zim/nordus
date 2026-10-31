import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import type { KnowledgeSpaceId, WikiGraph } from "../../../shared/knowledge";
import { wikiApi } from "@/lib/knowledge-api";
import { knowledgeErrorText } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { GRAPH_SIZE, layoutGraph } from "@/lib/wiki-graph-layout";
import { Loading, Problem } from "./knowledge-shared";

const LABELS_ALL_BELOW = 45;
const LABEL_DEGREE = 3;

interface View {
  x: number;
  y: number;
  size: number;
}

const WHOLE: View = { x: 0, y: 0, size: GRAPH_SIZE };

function connect(map: Map<string, Set<string>>, from: string, to: string) {
  const known = map.get(from);
  if (known) known.add(to);
  else map.set(from, new Set([to]));
}

export function WikiGraphView({ space, current, onOpen }: { space: KnowledgeSpaceId; current: string | null; onOpen: (id: string) => void }) {
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(WHOLE);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setGraph(null);
    setError(null);
    setView(WHOLE);
    wikiApi.graph(space).then(
      (loaded) => { if (live) setGraph(loaded); },
      (reason: unknown) => { if (live) setError(knowledgeErrorText(reason)); },
    );
    return () => { live = false; };
  }, [space, attempt]);

  const layout = useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of layout?.edges ?? []) {
      connect(map, edge.source.id, edge.target.id);
      connect(map, edge.target.id, edge.source.id);
    }
    return map;
  }, [layout]);

  if (error) return <Problem text={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!layout) return <Loading />;
  if (layout.nodes.length === 0 || layout.edges.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-16 text-center">
        <p className="text-[15px] font-medium">{t("wiki.graph.empty.title")}</p>
        <p className="max-w-sm text-[13px] text-ink-secondary">{t("wiki.graph.empty.hint")}</p>
      </div>
    );
  }

  const showAllLabels = layout.nodes.length <= LABELS_ALL_BELOW;
  const zoom = (factor: number) => setView((from) => {
    const size = Math.min(GRAPH_SIZE * 1.5, Math.max(120, from.size * factor));
    const center = { x: from.x + from.size / 2, y: from.y + from.size / 2 };
    return { x: center.x - size / 2, y: center.y - size / 2, size };
  });
  const startDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, view };
  };
  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    const box = event.currentTarget.getBoundingClientRect();
    const scale = start.view.size / Math.max(1, Math.min(box.width, box.height));
    setView({ ...start.view, x: start.view.x - (event.clientX - start.x) * scale, y: start.view.y - (event.clientY - start.y) * scale });
  };
  const open = (id: string) => () => onOpen(id);
  const openOnKey = (id: string) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(id);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <svg
        role="group"
        aria-label={t("wiki.graph.title")}
        viewBox={`${view.x} ${view.y} ${view.size} ${view.size}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full min-h-[24rem] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <g>
          {layout.edges.map((edge) => {
            const lit = hover !== null && (edge.source.id === hover || edge.target.id === hover);
            return <line key={`${edge.source.id}>${edge.target.id}`} x1={edge.source.x} y1={edge.source.y} x2={edge.target.x} y2={edge.target.y} className={lit ? "stroke-accent" : "stroke-ink-tertiary"} strokeOpacity={lit ? 0.9 : hover ? 0.08 : 0.3} strokeWidth={lit ? 2 : 1} />;
          })}
        </g>
        <g>
          {layout.nodes.map((node) => {
            const near = hover === node.id || (hover !== null && neighbors.get(hover)?.has(node.id) === true);
            const dimmed = hover !== null && !near;
            const isCurrent = node.id === current;
            const label = showAllLabels || node.degree >= LABEL_DEGREE || near || isCurrent;
            return (
              <g
                key={node.id}
                role="link"
                tabIndex={0}
                aria-label={t("wiki.graph.open", { title: node.title })}
                onClick={open(node.id)}
                onKeyDown={openOnKey(node.id)}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(node.id)}
                onBlur={() => setHover(null)}
                opacity={dimmed ? 0.25 : 1}
                className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-focus [&:focus-visible>circle]:stroke-[3]"
              >
                <title>{node.folder ? `${node.folder}/${node.title}` : node.title}</title>
                <circle cx={node.x} cy={node.y} r={node.radius} className={isCurrent ? "fill-accent stroke-ink" : "fill-accent/70 stroke-app"} strokeWidth={isCurrent ? 3 : 1.5} />
                {label && (
                  <text x={node.x} y={node.y + node.radius + 15} textAnchor="middle" className="fill-ink" fontSize={13} paintOrder="stroke" stroke="var(--color-app)" strokeWidth={3} strokeLinejoin="round">
                    {node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute end-4 top-3 flex flex-col gap-1 rounded-xl border border-hairline/40 bg-card/80 p-1 backdrop-blur">
        <button type="button" className="ui-icon-button" onClick={() => zoom(0.7)} aria-label={t("wiki.graph.zoomIn")} title={t("wiki.graph.zoomIn")}><ZoomIn size={15} /></button>
        <button type="button" className="ui-icon-button" onClick={() => zoom(1.4)} aria-label={t("wiki.graph.zoomOut")} title={t("wiki.graph.zoomOut")}><ZoomOut size={15} /></button>
        <button type="button" className="ui-icon-button" onClick={() => setView(WHOLE)} aria-label={t("wiki.graph.reset")} title={t("wiki.graph.reset")}><Maximize2 size={15} /></button>
      </div>
      {(layout.hidden > 0 || graph?.truncated) && (
        <p className="shrink-0 border-t border-hairline/30 px-4 py-2 text-[12px] text-ink-secondary" role="status">
          {t("wiki.graph.hidden", { shown: layout.nodes.length })}
        </p>
      )}
    </div>
  );
}
