/**
 * Tests for Graph Utilities (src/engine/graphUtils.js)
 *
 * Covers four exported functions:
 *   - getAdjacencyList: edge list → directed adjacency map
 *   - isValidTransition: single-edge existence check
 *   - getAllPaths: DFS enumeration of start→end paths
 *   - findBestMatchingPath: overlap-based best-path selection
 *
 * Uses two graph fixtures:
 *   1. loopingGraph  — the tech-support workflow, loaded from data/looping-graph.json
 *   2. branchyGraph  — a wider graph with multiple branches for edge cases
 */

const {
  getAdjacencyList,
  isValidTransition,
  getAllPaths,
  findBestMatchingPath,
} = require('../src/engine/graphUtils');

// ─── Test Fixtures ───────────────────────────────────────────────

/**
 * Tech-support workflow graph, loaded from the real data fixture
 * (data/looping-graph.json):
 *
 *   1 (start) → 2 (process) → 3 (decision) → 4 (process) → 5 (end)
 *                    ↑___________┘ (3 → 2 loop)  └─────────→ 5 (end)
 *
 * The 3 → 2 edge is a loop (cycle). getAllPaths enumerates only acyclic
 * start→end paths, so there are still exactly two valid paths:
 *   Path A: 1 → 2 → 3 → 4 → 5  (through escalation)
 *   Path B: 1 → 2 → 3 → 5      (happy path, skips escalation)
 */
const loopingGraph = require('../data/looping-graph.json');

/**
 * Branchy graph with two distinct branches and multiple end nodes:
 *
 *   A (start) → B → C → D → G (end)
 *                  └→ E → F → G (end)
 *
 * Two valid paths:
 *   Path 1: A → B → C → D → G
 *   Path 2: A → B → E → F → G
 */
const branchyGraph = {
  nodes: [
    { id: 'A', type: 'start' },
    { id: 'B', type: 'decision' },
    { id: 'C', type: 'process' },
    { id: 'D', type: 'process' },
    { id: 'E', type: 'process' },
    { id: 'F', type: 'process' },
    { id: 'G', type: 'end' },
  ],
  edges: [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
    { source: 'B', target: 'E' },
    { source: 'C', target: 'D' },
    { source: 'D', target: 'G' },
    { source: 'E', target: 'F' },
    { source: 'F', target: 'G' },
  ],
};

// ─── getAdjacencyList ────────────────────────────────────────────

describe('getAdjacencyList', () => {
  test('builds correct adjacency map for looping graph', () => {
    const adj = getAdjacencyList(loopingGraph);

    expect(adj['1']).toEqual(new Set(['2']));
    expect(adj['2']).toEqual(new Set(['3']));
    expect(adj['3']).toEqual(new Set(['2', '4', '5'])); // 3 → 2 is the loop-back edge
    expect(adj['4']).toEqual(new Set(['5']));
  });

  test('leaf nodes (end nodes) have no outgoing edges', () => {
    const adj = getAdjacencyList(loopingGraph);

    expect(adj['5']).toBeUndefined();
  });

  test('values are Sets, not arrays', () => {
    const adj = getAdjacencyList(loopingGraph);

    expect(adj['1']).toBeInstanceOf(Set);
    expect(adj['3']).toBeInstanceOf(Set);
  });

  test('handles branchy graph with diverging paths', () => {
    const adj = getAdjacencyList(branchyGraph);

    expect(adj['B']).toEqual(new Set(['C', 'E']));
    expect(adj['D']).toEqual(new Set(['G']));
    expect(adj['F']).toEqual(new Set(['G']));
  });

  test('handles graph with no edges', () => {
    const emptyGraph = {
      nodes: [{ id: '1', type: 'start' }],
      edges: [],
    };
    const adj = getAdjacencyList(emptyGraph);

    expect(adj).toEqual({});
  });
});

// ─── isValidTransition ──────────────────────────────────────────

describe('isValidTransition', () => {
  const adj = getAdjacencyList(loopingGraph);

  test('returns true for direct edges', () => {
    expect(isValidTransition('1', '2', adj)).toBe(true);
    expect(isValidTransition('3', '4', adj)).toBe(true);
    expect(isValidTransition('3', '5', adj)).toBe(true);
    expect(isValidTransition('4', '5', adj)).toBe(true);
  });

  test('returns false for non-adjacent nodes', () => {
    expect(isValidTransition('1', '3', adj)).toBe(false);
    expect(isValidTransition('2', '5', adj)).toBe(false);
    expect(isValidTransition('1', '5', adj)).toBe(false);
  });

  test('returns false for reverse edges (graph is directed)', () => {
    expect(isValidTransition('2', '1', adj)).toBe(false);
    expect(isValidTransition('5', '3', adj)).toBe(false);
  });

  test('returns false for self-loops (none in our graphs)', () => {
    expect(isValidTransition('1', '1', adj)).toBe(false);
  });

  test('returns false when source node has no outgoing edges', () => {
    expect(isValidTransition('5', '1', adj)).toBe(false);
  });

  test('returns false for non-existent node IDs', () => {
    expect(isValidTransition('99', '1', adj)).toBe(false);
    expect(isValidTransition('1', '99', adj)).toBe(false);
  });
});

// ─── getAllPaths ─────────────────────────────────────────────────

describe('getAllPaths', () => {
  test('finds both paths in looping graph', () => {
    const paths = getAllPaths(loopingGraph);

    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(['1', '2', '3', '4', '5']);
    expect(paths).toContainEqual(['1', '2', '3', '5']);
  });

  test('finds both branches in branchy graph', () => {
    const paths = getAllPaths(branchyGraph);

    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(['A', 'B', 'C', 'D', 'G']);
    expect(paths).toContainEqual(['A', 'B', 'E', 'F', 'G']);
  });

  test('every path starts at the start node', () => {
    const paths = getAllPaths(loopingGraph);

    for (const path of paths) {
      expect(path[0]).toBe('1');
    }
  });

  test('every path ends at an end node', () => {
    const paths = getAllPaths(loopingGraph);

    for (const path of paths) {
      expect(path[path.length - 1]).toBe('5');
    }
  });

  test('returns empty array when graph has no start node', () => {
    const noStartGraph = {
      nodes: [
        { id: '1', type: 'process' },
        { id: '2', type: 'end' },
      ],
      edges: [{ source: '1', target: '2' }],
    };

    expect(getAllPaths(noStartGraph)).toEqual([]);
  });

  test('returns empty array when no path reaches an end node', () => {
    const deadEndGraph = {
      nodes: [
        { id: '1', type: 'start' },
        { id: '2', type: 'process' },
        // No end node
      ],
      edges: [{ source: '1', target: '2' }],
    };

    expect(getAllPaths(deadEndGraph)).toEqual([]);
  });

  test('handles linear graph (single path, no branches)', () => {
    const linearGraph = {
      nodes: [
        { id: '1', type: 'start' },
        { id: '2', type: 'process' },
        { id: '3', type: 'end' },
      ],
      edges: [
        { source: '1', target: '2' },
        { source: '2', target: '3' },
      ],
    };
    const paths = getAllPaths(linearGraph);

    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual(['1', '2', '3']);
  });

  test('handles graph with multiple end nodes', () => {
    const multiEndGraph = {
      nodes: [
        { id: '1', type: 'start' },
        { id: '2', type: 'end' },
        { id: '3', type: 'end' },
      ],
      edges: [
        { source: '1', target: '2' },
        { source: '1', target: '3' },
      ],
    };
    const paths = getAllPaths(multiEndGraph);

    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(['1', '2']);
    expect(paths).toContainEqual(['1', '3']);
  });
});

// ─── findBestMatchingPath ───────────────────────────────────────

describe('findBestMatchingPath', () => {
  const allPaths = getAllPaths(loopingGraph);

  test('picks the happy path when agent skips error handling', () => {
    // Agent visited 1 → 2 → 3 → 5 (skipped node 4)
    const best = findBestMatchingPath(allPaths, ['1', '2', '3', '5']);

    // Short path has 4/4 overlap vs long path 4/5 overlap — same count, shorter wins
    expect(best).toEqual(['1', '2', '3', '5']);
  });

  test('picks the longer path when agent visited error handling', () => {
    // Agent visited 1 → 2 → 3 → 4 → 5 (went through error handling)
    const best = findBestMatchingPath(allPaths, ['1', '2', '3', '4', '5']);

    // Long path has 5/5 overlap vs short path 4/4 — 5 > 4, long path wins
    expect(best).toEqual(['1', '2', '3', '4', '5']);
  });

  test('tie-breaks by shorter path on equal overlap', () => {
    // Agent visited only the first 3 nodes (abandoned early)
    const best = findBestMatchingPath(allPaths, ['1', '2', '3']);

    // Both paths share nodes 1,2,3 → 3 overlap each, shorter wins
    expect(best).toEqual(['1', '2', '3', '5']);
  });

  test('picks correct branch in branchy graph', () => {
    const branchPaths = getAllPaths(branchyGraph);

    // Agent took branch 2: A → B → E → F → G
    const best = findBestMatchingPath(branchPaths, ['A', 'B', 'E', 'F', 'G']);

    expect(best).toEqual(['A', 'B', 'E', 'F', 'G']);
  });

  test('handles agent that skipped a node on a branch', () => {
    const branchPaths = getAllPaths(branchyGraph);

    // Agent visited A → B → C → G (skipped D)
    const best = findBestMatchingPath(branchPaths, ['A', 'B', 'C', 'G']);

    // Path 1 [A,B,C,D,G] has 4/5 overlap, Path 2 [A,B,E,F,G] has 3/5 overlap
    expect(best).toEqual(['A', 'B', 'C', 'D', 'G']);
  });

  test('returns empty array when no paths exist', () => {
    const best = findBestMatchingPath([], ['1', '2', '3']);

    expect(best).toEqual([]);
  });

  test('returns first path when agent visited no known nodes', () => {
    // Agent visited only off-workflow nodes (all filtered out before this call)
    const best = findBestMatchingPath(allPaths, []);

    // 0 overlap for all paths, falls back to shorter path (tie-break)
    expect(best).toEqual(['1', '2', '3', '5']);
  });

  test('handles single-node overlap correctly', () => {
    const branchPaths = getAllPaths(branchyGraph);

    // Agent only visited node E (unique to branch 2)
    const best = findBestMatchingPath(branchPaths, ['E']);

    // Path 2 has 1 overlap (E), Path 1 has 0 overlap
    expect(best).toEqual(['A', 'B', 'E', 'F', 'G']);
  });
});
