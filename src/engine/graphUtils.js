/**
 * Graph Utilities for Workflow Verification Engine
 *
 * Pure, deterministic functions for analyzing workflow graphs.
 * These utilities power the scoring layer (Stage 3) by providing
 * adjacency lookups, transition validation, path enumeration,
 * and best-path matching.
 *
 * All functions are side-effect-free and operate on the standard
 * graph format: { nodes: [{ id, type, ... }], edges: [{ source, target }] }
 */

// ─── Adjacency List ──────────────────────────────────────────────

/**
 * Builds a directed adjacency list from the graph's edge definitions.
 *
 * @param {Object} graph - Workflow graph with `edges` array
 * @param {Array}  graph.edges - Edges with { source, target } properties
 * @returns {Object} Map of nodeId → array of directly reachable nodeIds
 *
 * @example
 *   const adj = getAdjacencyList(graph);
 *   // { "1": Set{"2"}, "2": Set{"3"}, "3": Set{"4","5"}, "4": Set{"5"} }
 */
function getAdjacencyList(graph) {
  const adjacency = {};

  for (const edge of graph.edges) {
    if (!adjacency[edge.source]) {
      adjacency[edge.source] = new Set();
    }
    adjacency[edge.source].add(edge.target);
  }

  return adjacency;
}

// ─── Transition Validation ───────────────────────────────────────

/**
 * Checks whether a direct edge exists between two nodes.
 *
 * @param {string} from          - Source node ID
 * @param {string} to            - Target node ID
 * @param {Object} adjacencyList - Output of getAdjacencyList()
 * @returns {boolean} True if `from → to` is a valid single-step transition
 *
 * @example
 *   isValidTransition("3", "5", adj); // true  (edge exists)
 *   isValidTransition("2", "5", adj); // false (no direct edge)
 */
function isValidTransition(from, to, adjacencyList) {
  return adjacencyList[from]?.has(to) || false;
}

// ─── Path Enumeration ────────────────────────────────────────────

/**
 * Enumerates every valid complete path through the workflow graph
 * using depth-first search from the start node to any end node.
 *
 * A "complete path" begins at the single start node and terminates
 * at any node with type "end". Cycles are avoided via a visited set.
 *
 * @param {Object} graph - Workflow graph with `nodes` and `edges`
 * @returns {string[][]} Array of paths, each path is an ordered array of node IDs
 *
 * @example
 *   getAllPaths(graph);
 *   // [["1","2","3","4","5"], ["1","2","3","5"]]
 */
function getAllPaths(graph) {
  const adjacency = getAdjacencyList(graph);
  const startNode = graph.nodes.find((n) => n.type === 'start');
  const endNodeIds = graph.nodes
    .filter((n) => n.type === 'end')
    .map((n) => n.id);

  // Guard: no start node means no valid paths
  if (!startNode) return [];

  const allPaths = [];

  /**
   * Recursive DFS that accumulates paths ending at any end node.
   * Uses backtracking with a visited set to avoid cycles.
   */
  function dfs(current, path, visited) {
    // Path is complete when we reach an end node
    if (endNodeIds.includes(current)) {
      allPaths.push([...path]);
      return;
    }

    const neighbors = adjacency[current] || new Set();
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);

        dfs(next, path, visited);

        // Backtrack to explore other branches
        path.pop();
        visited.delete(next);
      }
    }
  }

  dfs(startNode.id, [startNode.id], new Set([startNode.id]));

  return allPaths;
}

// ─── Best Path Matching ──────────────────────────────────────────

/**
 * Finds the valid graph path that most closely matches the nodes
 * the agent actually visited during the conversation.
 *
 * Strategy:
 *   1. Score each candidate path by how many of its nodes appear
 *      in the visited set (overlap count).
 *   2. Tie-break: prefer the shorter path. A shorter path means
 *      fewer "expected but unvisited" nodes, reflecting the assumption
 *      that the agent intended the simpler route.
 *
 * This drives path-based completeness — only nodes on the best
 * matching path are treated as "required."
 *
 * @param {string[][]} allPaths     - Output of getAllPaths()
 * @param {string[]}   visitedNodes - Unique node IDs the agent visited (no off_workflow)
 * @returns {string[]} The best matching complete path
 *
 * @example
 *   // Agent visited [1, 2, 3, 5] — skipped node 4
 *   findBestMatchingPath(allPaths, ["1","2","3","5"]);
 *   // Returns ["1","2","3","5"] (4/4 overlap, shorter than 5-node path)
 */
function findBestMatchingPath(allPaths, visitedNodes) {
  // Fallback for edge cases (empty graph, no paths found)
  if (allPaths.length === 0) return [];

  let bestPath = allPaths[0];
  let bestOverlap = 0;

  for (const path of allPaths) {
    const overlap = path.filter((node) => visitedNodes.includes(node)).length;

    const isBetterOverlap = overlap > bestOverlap;
    const isSameOverlapButShorter =
      overlap === bestOverlap && path.length < bestPath.length;

    if (isBetterOverlap || isSameOverlapButShorter) {
      bestPath = path;
      bestOverlap = overlap;
    }
  }

  return bestPath;
}

module.exports = {
  getAdjacencyList,
  isValidTransition,
  getAllPaths,
  findBestMatchingPath,
};
