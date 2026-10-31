import type { WikiGraph } from "../../shared/knowledge";

export const GRAPH_NODES_SHOWN = 400;
export const GRAPH_SIZE = 1000;

export interface PlacedNode {
  id: string;
  title: string;
  folder: string;
  degree: number;
  x: number;
  y: number;
  radius: number;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: Array<{ source: PlacedNode; target: PlacedNode }>;
  /** Pages left out because only the most linked ones are drawn. */
  hidden: number;
}

/** The same pages and links always land in the same places, so the picture does not shuffle between visits. */
export function layoutGraph(graph: WikiGraph, shown = GRAPH_NODES_SHOWN): GraphLayout {
  const ranked = [...graph.nodes].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, shown);
  const count = ranked.length;
  const center = GRAPH_SIZE / 2;
  const ring = GRAPH_SIZE * 0.4;
  const placed: PlacedNode[] = ranked.map((node, index) => {
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    const spiral = ring * (0.25 + 0.75 * ((index % 7) / 7));
    return { ...node, x: center + Math.cos(angle) * spiral, y: center + Math.sin(angle) * spiral, radius: 5 + Math.min(14, Math.sqrt(node.degree) * 2.4) };
  });
  const byId = new Map(placed.map((node) => [node.id, node] as const));
  const edges = graph.edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source && target && source !== target ? [{ source, target }] : [];
  });

  if (count > 1) {
    const iterations = Math.max(30, Math.min(260, Math.floor(3_000_000 / (count * count))));
    const ideal = Math.sqrt((GRAPH_SIZE * GRAPH_SIZE) / count) * 0.62;
    const dx = new Float64Array(count);
    const dy = new Float64Array(count);
    const index = new Map(placed.map((node, at) => [node, at] as const));
    for (let step = 0; step < iterations; step += 1) {
      dx.fill(0);
      dy.fill(0);
      for (let a = 0; a < count; a += 1) {
        for (let b = a + 1; b < count; b += 1) {
          let gx = placed[a]!.x - placed[b]!.x;
          let gy = placed[a]!.y - placed[b]!.y;
          let distance = Math.hypot(gx, gy);
          if (distance < 0.01) {
            gx = ((a * 31 + b * 17) % 7) - 3 || 1;
            gy = ((a * 13 + b * 29) % 5) - 2 || 1;
            distance = Math.hypot(gx, gy);
          }
          const push = (ideal * ideal) / distance;
          dx[a]! += (gx / distance) * push;
          dy[a]! += (gy / distance) * push;
          dx[b]! -= (gx / distance) * push;
          dy[b]! -= (gy / distance) * push;
        }
      }
      for (const edge of edges) {
        const a = index.get(edge.source)!;
        const b = index.get(edge.target)!;
        const gx = edge.source.x - edge.target.x;
        const gy = edge.source.y - edge.target.y;
        const distance = Math.max(0.01, Math.hypot(gx, gy));
        const pull = (distance * distance) / ideal;
        dx[a]! -= (gx / distance) * pull;
        dy[a]! -= (gy / distance) * pull;
        dx[b]! += (gx / distance) * pull;
        dy[b]! += (gy / distance) * pull;
      }
      const cooling = 1 - step / iterations;
      const limit = ideal * 0.35 * cooling + 0.5;
      for (let at = 0; at < count; at += 1) {
        const node = placed[at]!;
        const gravity = 0.02;
        const length = Math.hypot(dx[at]!, dy[at]!) || 1;
        const move = Math.min(length, limit);
        node.x += (dx[at]! / length) * move + (center - node.x) * gravity;
        node.y += (dy[at]! / length) * move + (center - node.y) * gravity;
      }
    }
  }

  const margin = 40;
  for (const node of placed) {
    node.x = Math.min(GRAPH_SIZE - margin, Math.max(margin, node.x));
    node.y = Math.min(GRAPH_SIZE - margin, Math.max(margin, node.y));
  }
  return { nodes: placed, edges, hidden: Math.max(0, graph.nodes.length - count) };
}
