import { describe, expect, it } from "vitest";

import type { WikiGraph } from "../../shared/knowledge";
import { GRAPH_SIZE, layoutGraph } from "./wiki-graph-layout";

const graph = (count: number, link: (index: number) => number | null): WikiGraph => ({
  nodes: Array.from({ length: count }, (_, index) => ({ id: `p${index}`, title: `Page ${index}`, folder: "", degree: index % 5 })),
  edges: Array.from({ length: count }, (_, index) => ({ index, to: link(index) })).flatMap(({ index, to }) => (to === null ? [] : [{ source: `p${index}`, target: `p${to}` }])),
  truncated: false,
});

describe("the graph layout", () => {
  it("puts the same pages in the same places every time", () => {
    const pages = graph(40, (index) => (index + 1) % 40);
    expect(layoutGraph(pages).nodes.map((node) => [node.x, node.y])).toEqual(layoutGraph(pages).nodes.map((node) => [node.x, node.y]));
  });

  it("keeps every page on the canvas, with no broken numbers, even for pages stacked on one another", () => {
    const stacked = graph(30, () => null);
    const layout = layoutGraph(stacked);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(GRAPH_SIZE);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(GRAPH_SIZE);
    }
    expect(new Set(layout.nodes.map((node) => `${Math.round(node.x)},${Math.round(node.y)}`)).size).toBeGreaterThan(20);
  });

  it("draws the most linked pages when there are too many, and says how many were left out", () => {
    const layout = layoutGraph(graph(60, (index) => (index + 7) % 60), 25);
    expect(layout.nodes).toHaveLength(25);
    expect(layout.hidden).toBe(35);
    expect(Math.min(...layout.nodes.map((node) => node.degree))).toBeGreaterThanOrEqual(2);
    expect(layout.edges.every((edge) => layout.nodes.includes(edge.source) && layout.nodes.includes(edge.target))).toBe(true);
  });

  it("handles no pages and one page", () => {
    expect(layoutGraph({ nodes: [], edges: [], truncated: false })).toEqual({ nodes: [], edges: [], hidden: 0 });
    expect(layoutGraph(graph(1, () => null)).nodes).toHaveLength(1);
  });

  it("pulls linked pages closer than unlinked ones", () => {
    const pages: WikiGraph = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, title: id, folder: "", degree: 1 })),
      edges: [{ source: "a", target: "b" }, { source: "c", target: "d" }],
      truncated: false,
    };
    const layout = layoutGraph(pages);
    const at = (id: string) => layout.nodes.find((node) => node.id === id)!;
    const gap = (x: string, y: string) => Math.hypot(at(x).x - at(y).x, at(x).y - at(y).y);
    expect(gap("a", "b")).toBeLessThan(gap("a", "c"));
    expect(gap("c", "d")).toBeLessThan(gap("b", "d"));
  });
});
