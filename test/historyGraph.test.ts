import { describe, expect, it } from "vitest";
import {
  historyGraphEdgePath,
  historyGraphNodePosition,
  layoutHistoryGraph,
  type HistoryGraphCommit
} from "../src/historyGraph";

function commit(hash: string, parents: string[] = []): HistoryGraphCommit {
  return { hash, parents };
}

describe("history graph layout", () => {
  it("keeps a linear first-parent history in one lane", () => {
    const layout = layoutHistoryGraph([
      commit("three", ["two"]),
      commit("two", ["one"]),
      commit("one")
    ]);

    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 0]);
    expect(layout.edges.map((edge) => [edge.fromLane, edge.toLane])).toEqual([
      [0, 0],
      [0, 0]
    ]);
    expect(layout.laneCount).toBe(1);
  });

  it("gives divergent branch tips stable lanes until their shared ancestor", () => {
    const layout = layoutHistoryGraph([
      commit("main", ["base"]),
      commit("feature", ["base"]),
      commit("base")
    ]);

    expect(layout.nodes.map((node) => [node.hash, node.lane])).toEqual([
      ["main", 0],
      ["feature", 1],
      ["base", 0]
    ]);
    expect(layout.edges.find((edge) => edge.fromHash === "feature")).toMatchObject({
      fromLane: 1,
      toLane: 0,
      secondary: false
    });
  });

  it("routes a merge parent away from the merge and back at its ancestor", () => {
    const layout = layoutHistoryGraph([
      commit("merge", ["main", "topic"]),
      commit("main", ["base"]),
      commit("topic", ["base"]),
      commit("base")
    ]);

    expect(layout.nodes.map((node) => [node.hash, node.lane])).toEqual([
      ["merge", 0],
      ["main", 0],
      ["topic", 1],
      ["base", 0]
    ]);
    expect(layout.edges.find((edge) => edge.fromHash === "merge" && edge.toHash === "topic")).toMatchObject({
      fromLane: 0,
      toLane: 1,
      secondary: true
    });
    expect(layout.edges.find((edge) => edge.fromHash === "topic")).toMatchObject({
      fromLane: 1,
      toLane: 0,
      secondary: false
    });
  });

  it("allocates one lane for every parent of an octopus merge", () => {
    const layout = layoutHistoryGraph([
      commit("merge", ["one", "two", "three"]),
      commit("one"),
      commit("two"),
      commit("three")
    ]);

    expect(layout.laneCount).toBe(3);
    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 1, 2]);
    expect(layout.edges.filter((edge) => edge.fromHash === "merge" && edge.secondary)).toHaveLength(2);
  });

  it("extends parents outside truncated history to the graph boundary", () => {
    const layout = layoutHistoryGraph([commit("visible", ["outside"])]);
    const edge = layout.edges[0];

    expect(edge).toMatchObject({ boundary: true, toIndex: 0.5 });
    expect(historyGraphEdgePath(edge!, {
      rowHeight: 34,
      laneWidth: 20,
      offsetX: 20
    })).toBe("M 20 17 L 20 34");
  });

  it("produces source-side curves for merge parents", () => {
    const layout = layoutHistoryGraph([
      commit("merge", ["main", "topic"]),
      commit("main"),
      commit("topic")
    ]);
    const edge = layout.edges.find((candidate) => candidate.secondary);
    const geometry = { rowHeight: 34, laneWidth: 20, offsetX: 20 };

    expect(edge).toBeDefined();
    expect(historyGraphEdgePath(edge!, geometry)).toContain("C 20");
    expect(historyGraphNodePosition(layout.nodes[2]!, geometry)).toEqual({
      x: 40,
      y: 85
    });
  });
});
