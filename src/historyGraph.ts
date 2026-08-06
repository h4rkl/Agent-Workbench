export interface HistoryGraphCommit {
  hash: string;
  parents?: readonly string[];
}

export interface HistoryGraphNode {
  hash: string;
  index: number;
  lane: number;
  colorIndex: number;
}

export interface HistoryGraphEdge {
  fromHash: string;
  toHash: string;
  fromIndex: number;
  toIndex: number;
  fromLane: number;
  toLane: number;
  colorIndex: number;
  secondary: boolean;
  boundary: boolean;
}

export interface HistoryGraphLayout {
  nodes: HistoryGraphNode[];
  edges: HistoryGraphEdge[];
  laneCount: number;
}

export interface HistoryGraphGeometry {
  rowHeight: number;
  laneWidth: number;
  offsetX: number;
}

interface ActiveLane {
  hash: string;
  colorIndex: number;
}

interface ParentRoute {
  hash: string;
  lane: number;
  colorIndex: number;
  secondary: boolean;
}

function firstAvailableLane(lanes: readonly (ActiveLane | undefined)[]): number {
  const available = lanes.findIndex((lane) => lane === undefined);
  return available === -1 ? lanes.length : available;
}

function laneForHash(
  lanes: readonly (ActiveLane | undefined)[],
  hash: string,
  excludedLane = -1
): number {
  return lanes.findIndex(
    (lane, index) => index !== excludedLane && lane?.hash === hash
  );
}

/**
 * Assign stable lanes to commits ordered newest-to-oldest in topological order.
 * Empty lanes are retained and reused so unrelated branches do not jump sideways
 * merely because another branch ended earlier in the history.
 */
export function layoutHistoryGraph(
  commits: readonly HistoryGraphCommit[]
): HistoryGraphLayout {
  const lanes: Array<ActiveLane | undefined> = [];
  const nodes: HistoryGraphNode[] = [];
  const routesByCommit: ParentRoute[][] = [];
  let nextColorIndex = 0;
  let laneCount = 0;

  for (const [index, commit] of commits.entries()) {
    let lane = laneForHash(lanes, commit.hash);
    if (lane === -1) {
      lane = firstAvailableLane(lanes);
      lanes[lane] = { hash: commit.hash, colorIndex: nextColorIndex };
      nextColorIndex += 1;
    }

    const activeLane = lanes[lane];
    if (!activeLane) {
      continue;
    }

    laneCount = Math.max(laneCount, lane + 1);
    nodes.push({
      hash: commit.hash,
      index,
      lane,
      colorIndex: activeLane.colorIndex
    });

    const parents = [...new Set(commit.parents || [])].filter(
      (parent) => Boolean(parent) && parent !== commit.hash
    );
    const routes: ParentRoute[] = [];
    const firstParent = parents[0];

    if (!firstParent) {
      lanes[lane] = undefined;
    } else {
      const existingLane = laneForHash(lanes, firstParent, lane);
      if (existingLane === -1) {
        lanes[lane] = {
          hash: firstParent,
          colorIndex: activeLane.colorIndex
        };
        routes.push({
          hash: firstParent,
          lane,
          colorIndex: activeLane.colorIndex,
          secondary: false
        });
      } else {
        const existing = lanes[existingLane];
        lanes[lane] = undefined;
        if (existing) {
          routes.push({
            hash: firstParent,
            lane: existingLane,
            colorIndex: existing.colorIndex,
            secondary: false
          });
        }
      }
    }

    for (const parent of parents.slice(1)) {
      let parentLane = laneForHash(lanes, parent);
      if (parentLane === -1) {
        parentLane = firstAvailableLane(lanes);
        lanes[parentLane] = {
          hash: parent,
          colorIndex: nextColorIndex
        };
        nextColorIndex += 1;
      }
      const parentActiveLane = lanes[parentLane];
      if (!parentActiveLane) {
        continue;
      }
      laneCount = Math.max(laneCount, parentLane + 1);
      routes.push({
        hash: parent,
        lane: parentLane,
        colorIndex: parentActiveLane.colorIndex,
        secondary: true
      });
    }

    routesByCommit[index] = routes;
  }

  const nodesByHash = new Map(nodes.map((node) => [node.hash, node]));
  const edges: HistoryGraphEdge[] = [];

  for (const node of nodes) {
    const routes = routesByCommit[node.index] || [];
    for (const route of routes) {
      const candidate = nodesByHash.get(route.hash);
      const target = candidate && candidate.index > node.index
        ? candidate
        : undefined;
      edges.push({
        fromHash: node.hash,
        toHash: route.hash,
        fromIndex: node.index,
        toIndex: target?.index ?? commits.length - 0.5,
        fromLane: node.lane,
        toLane: target?.lane ?? route.lane,
        colorIndex: route.secondary ? route.colorIndex : node.colorIndex,
        secondary: route.secondary,
        boundary: target === undefined
      });
    }
  }

  return { nodes, edges, laneCount };
}

function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function historyGraphNodePosition(
  node: Pick<HistoryGraphNode, "index" | "lane">,
  geometry: HistoryGraphGeometry
): { x: number; y: number } {
  return {
    x: geometry.offsetX + node.lane * geometry.laneWidth,
    y: (node.index + 0.5) * geometry.rowHeight
  };
}

/** Build a compact, Git-client-style path between two assigned lanes. */
export function historyGraphEdgePath(
  edge: HistoryGraphEdge,
  geometry: HistoryGraphGeometry
): string {
  const from = historyGraphNodePosition(
    { index: edge.fromIndex, lane: edge.fromLane },
    geometry
  );
  const to = historyGraphNodePosition(
    { index: edge.toIndex, lane: edge.toLane },
    geometry
  );

  if (from.x === to.x) {
    return `M ${coordinate(from.x)} ${coordinate(from.y)} L ${coordinate(to.x)} ${coordinate(to.y)}`;
  }

  const span = Math.max(0, to.y - from.y);
  const transition = Math.min(geometry.rowHeight * 0.7, span / 2);

  if (edge.secondary) {
    const bendY = from.y + transition;
    return [
      `M ${coordinate(from.x)} ${coordinate(from.y)}`,
      `C ${coordinate(from.x)} ${coordinate(from.y + transition * 0.65)}`,
      `${coordinate(to.x)} ${coordinate(bendY - transition * 0.35)}`,
      `${coordinate(to.x)} ${coordinate(bendY)}`,
      `L ${coordinate(to.x)} ${coordinate(to.y)}`
    ].join(" ");
  }

  const bendY = to.y - transition;
  return [
    `M ${coordinate(from.x)} ${coordinate(from.y)}`,
    `L ${coordinate(from.x)} ${coordinate(bendY)}`,
    `C ${coordinate(from.x)} ${coordinate(bendY + transition * 0.35)}`,
    `${coordinate(to.x)} ${coordinate(to.y - transition * 0.65)}`,
    `${coordinate(to.x)} ${coordinate(to.y)}`
  ].join(" ");
}
