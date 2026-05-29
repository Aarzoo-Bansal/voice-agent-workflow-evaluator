/**
 * Scoring Engine for Workflow Verification
 *
 * Computes two independent scores from node mapping results:
 *
 *   Workflow Adherence (0–100): Did the agent follow the graph?
 *     - Completeness (30%): Were all required nodes visited?
 *     - Ordering    (25%): Were nodes visited in valid graph order?
 *     - Quality     (25%): How well was each node's purpose fulfilled?
 *     - Recovery    (20%): How gracefully were off-workflow detours handled?
 *
 *   Performance (0–100): Was the agent mechanically efficient?
 *     - Latency    (50%): How fast were assistant responses?
 *     - Efficiency (50%): How many turns did it take per required node?
 *
 * Design: ~65% of scoring is fully deterministic (completeness, ordering,
 * latency, efficiency). Quality and recovery use LLM-judged labels as input
 * but the aggregation itself is arithmetic — reproducible and unit-testable.
 */

const {
  getAdjacencyList,
  isValidTransition,
  getAllPaths,
  findBestMatchingPath,
} = require('./graphUtils');

const {
  ADHERENCE_WEIGHTS,
  PERFORMANCE_WEIGHTS,
  QUALITY_MAP,
  RECOVERY_MAP,
  LATENCY_THRESHOLDS,
  LATENCY_VIOLATION_THRESHOLD,
  EFFICIENCY_THRESHOLDS,
  NO_END_NODE_PENALTY,
  NO_START_NODE_PENALTY,
} = require('../config');

// ─── Completeness (Adherence, 30%) ──────────────────────────────

/**
 * Measures what fraction of required nodes the agent actually visited.
 *
 * "Required" is path-based, not static. We find the valid graph path
 * that best matches the agent's visited nodes, then check coverage
 * against that path. This correctly handles branching workflows —
 * nodes on untaken branches are not penalized.
 *
 * Penalty: If the last visited node is not an end node, the score
 * is reduced by 30% (multiplied by NO_END_NODE_PENALTY = 0.7).
 *
 * @param {Object[]} agentPath     - Node mapping results from Pass 2 (the agent's classified journey)
 * @param {Object}   workflowGraph - Expected workflow graph with nodes and edges
 * @returns {number} Score between 0.0 and 1.0
 */
function computeCompleteness(agentPath, workflowGraph) {
  const allPaths = getAllPaths(workflowGraph);
  if (allPaths.length === 0) return 0;

  // Extract unique visited node IDs, excluding off-workflow segments
  const visitedNodes = [
    ...new Set(
      agentPath
        .filter((m) => !m.nodeIds.includes('off_workflow'))
        .flatMap((m) => m.nodeIds)
    ),
  ];

  if (visitedNodes.length === 0) return 0;

  // Determine the path the agent most likely intended to follow
  const bestPath = findBestMatchingPath(allPaths, visitedNodes);
  const visitedFromPath = bestPath.filter((node) => visitedNodes.includes(node));

  let score = visitedFromPath.length / bestPath.length;

  // Penalize if the conversation didn't reach a terminal state
  const endNodeIds = workflowGraph.nodes
    .filter((n) => n.type === 'end')
    .map((n) => n.id);
  const lastVisited = visitedNodes[visitedNodes.length - 1];

  if (!endNodeIds.includes(lastVisited)) {
    score *= NO_END_NODE_PENALTY;
  }

  return score;
}

// ─── Ordering (Adherence, 25%) ──────────────────────────────────

/**
 * Measures how well the agent followed valid graph transitions.
 *
 * Uses Longest Valid Subsequence (LVS) — a variant of Longest
 * Increasing Subsequence where "increasing" means "valid graph
 * transition." This is fairer than naive consecutive-pair checking:
 *
 *   - Perfect order [1,2,3,5]:     LVS=4, total=4 → 1.0
 *   - Backtracking [1,2,1,2,3,5]: LVS=4, total=4 → 1.0 (deduped)
 *   - Wrong order [1,3,2,5]:       LVS=2, total=4 → 0.5
 *
 * Consecutive duplicate nodes are removed before scoring because
 * revisiting the same node isn't a transition violation.
 *
 * Penalty: If the first visited node isn't the start node,
 * score is reduced by 20% (multiplied by NO_START_NODE_PENALTY = 0.8).
 *
 * @param {Object[]} agentPath     - Node mapping results from Pass 2 (the agent's classified journey)
 * @param {Object}   workflowGraph - Expected workflow graph with nodes and edges
 * @returns {number} Score between 0.0 and 1.0
 */
function computeOrdering(agentPath, workflowGraph) {
  const adjacency = getAdjacencyList(workflowGraph);
  const startNode = workflowGraph.nodes.find((n) => n.type === 'start');

  // Build the visited sequence in order, excluding off-workflow
  const visitedSequence = agentPath
    .filter((m) => !m.nodeIds.includes('off_workflow'))
    .flatMap((m) => m.nodeIds);

  // Remove consecutive duplicates — revisiting the same node isn't a violation
  const deduped = visitedSequence.filter(
    (node, i) => i === 0 || node !== visitedSequence[i - 1]
  );

  // A single node or empty sequence has perfect ordering by definition
  if (deduped.length <= 1) return 1.0;

  // Longest Valid Subsequence via dynamic programming
  // dp[i] = length of longest valid subsequence ending at position i
  const n = deduped.length;
  const dp = new Array(n).fill(1);

  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (isValidTransition(deduped[j], deduped[i], adjacency)) {
        dp[i] = Math.max(dp[i], dp[j] + 1);
      }
    }
  }

  let score = Math.max(...dp) / deduped.length;

  // Penalize if the agent didn't begin at the workflow start node
  if (startNode && deduped[0] !== startNode.id) {
    score *= NO_START_NODE_PENALTY;
  }

  return score;
}

// ─── Quality (Adherence, 25%) ───────────────────────────────────

/**
 * Averages the quality ratings across all on-workflow node mappings.
 *
 * When qualityCriteria is available (from pre-defined criteria review),
 * uses ratio-based scoring: met_count / total_count. This gives granular
 * scores (e.g., 4/5 criteria met = 0.8) instead of the coarse 3-bucket
 * system (full=1.0, partial=0.5, none=0.0).
 *
 * Falls back to the label-based scoring when criteria are not available.
 *
 * @param {Object[]} agentPath - Node mapping results from Pass 2 (the agent's classified journey)
 * @returns {number} Score between 0.0 and 1.0
 */
function computeQuality(agentPath) {
  const nodeMappings = agentPath.filter(
    (m) => !m.nodeIds.includes('off_workflow')
  );

  if (nodeMappings.length === 0) return 0;

  // Group by node, merge criteria across segments, score per node.
  // A criterion met in ANY segment counts as met for the node.
  const nodeGroups = {};
  for (const m of nodeMappings) {
    for (const nodeId of m.nodeIds) {
      if (!nodeGroups[nodeId]) nodeGroups[nodeId] = [];
      nodeGroups[nodeId].push(m);
    }
  }

  let total = 0;
  const nodeIds = Object.keys(nodeGroups);

  for (const nodeId of nodeIds) {
    const mappings = nodeGroups[nodeId];

    // Merge all met/not_met criteria across segments
    const metSet = new Map();
    const notMetSet = new Map();

    for (const m of mappings) {
      const criteria = m.qualityCriteria;
      if (!criteria) continue;
      for (const item of (criteria.met || [])) {
        metSet.set(item.criterion, item);
      }
      for (const item of (criteria.not_met || [])) {
        if (!metSet.has(item.criterion)) {
          notMetSet.set(item.criterion, item);
        }
      }
    }

    // Remove from not_met anything met in another segment
    for (const key of metSet.keys()) {
      notMetSet.delete(key);
    }

    const metCount = metSet.size;
    const notMetCount = notMetSet.size;
    const totalCount = metCount + notMetCount;

    if (totalCount > 0) {
      total += metCount / totalCount;
    } else {
      // No criteria — fall back to best quality label
      const best = mappings.reduce((b, m) => {
        const score = QUALITY_MAP[m.quality] ?? 0;
        return score > b ? score : b;
      }, 0);
      total += best;
    }
  }

  return total / nodeIds.length;
}

// ─── Recovery (Adherence, 20%) ──────────────────────────────────

/**
 * Averages the recovery ratings across all off-workflow segments.
 *
 * Recovery measures how gracefully the agent handled detours —
 * user complaints, tangents, or topics not in the workflow graph.
 * Rated by the LLM as graceful/adequate/poor.
 *
 * If there are no off-workflow segments, the agent is not penalized
 * and receives a perfect recovery score of 1.0.
 *
 * @param {Object[]} agentPath - Node mapping results from Pass 2 (the agent's classified journey)
 * @returns {number} Score between 0.0 and 1.0
 */
function computeRecovery(agentPath) {
  const offWorkflow = agentPath.filter((m) =>
    m.nodeIds.includes('off_workflow')
  );

  // No detours = no penalty
  if (offWorkflow.length === 0) return 1.0;

  const total = offWorkflow.reduce(
    (sum, m) => sum + (RECOVERY_MAP[m.recovery] ?? 0),
    0
  );

  return total / offWorkflow.length;
}

// ─── Latency (Performance, 50%) ─────────────────────────────────

/**
 * Scores how quickly the assistant responded after each user turn.
 *
 * For every user→assistant transition, computes the gap between
 * the user's end timestamp and the assistant's beginning timestamp.
 * The average gap determines the score tier.
 *
 * Also reports max latency, per-turn latencies, and count of
 * violations (gaps exceeding LATENCY_VIOLATION_THRESHOLD).
 *
 * @param {Object[]} transcript - Conversation turns with beginning/end timestamps
 * @returns {Object} { score, avg, max, violations, all }
 */
function computeLatency(transcript) {
  const latencies = [];

  for (let i = 1; i < transcript.length; i++) {
    if (transcript[i].role === 'assistant' && transcript[i - 1].role === 'user') {
      latencies.push(transcript[i].beginning - transcript[i - 1].end);
    }
  }

  // No user→assistant pairs found (edge case: empty or single-turn transcript)
  if (latencies.length === 0) {
    return { score: 1.0, avg: 0, max: 0, violations: 0, all: [] };
  }

  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const max = Math.max(...latencies);
  const violations = latencies.filter((l) => l > LATENCY_VIOLATION_THRESHOLD).length;

  // Tiered scoring based on average response time
  let score;
  if (avg <= LATENCY_THRESHOLDS.excellent) score = 1.0;
  else if (avg <= LATENCY_THRESHOLDS.good) score = 0.75;
  else if (avg <= LATENCY_THRESHOLDS.fair) score = 0.5;
  else score = 0.25;

  return { score, avg, max, violations, all: latencies };
}

// ─── Efficiency (Performance, 50%) ──────────────────────────────

/**
 * Scores how concisely the agent completed the workflow.
 *
 * Measures total turns divided by the number of required nodes
 * on the best matching path. Fewer turns per node = more efficient.
 * Off-workflow segments inflate turn count (correctly penalizing
 * lengthy detours), but the denominator stays anchored to required nodes.
 *
 * @param {Object[]} transcript    - Conversation turns
 * @param {Object[]} agentPath     - Node mapping results from Pass 2 (the agent's classified journey)
 * @param {Object}   workflowGraph - Expected workflow graph with nodes and edges
 * @returns {Object} { score, totalTurns, duration, turnsPerNode }
 */
function computeEfficiency(transcript, agentPath, workflowGraph) {
  const totalTurns = transcript.length;
  const duration = transcript[transcript.length - 1].end - transcript[0].beginning;

  const allPaths = getAllPaths(workflowGraph);
  const visitedNodes = [
    ...new Set(
      agentPath
        .filter((m) => !m.nodeIds.includes('off_workflow'))
        .flatMap((m) => m.nodeIds)
    ),
  ];

  const bestPath = findBestMatchingPath(allPaths, visitedNodes);

  // Guard against division by zero (no valid paths in graph)
  if (bestPath.length === 0) {
    return { score: 0, totalTurns, duration, turnsPerNode: Infinity };
  }

  const turnsPerNode = totalTurns / bestPath.length;

  // Tiered scoring based on turns per required node
  let score;
  if (turnsPerNode <= EFFICIENCY_THRESHOLDS.excellent) score = 1.0;
  else if (turnsPerNode <= EFFICIENCY_THRESHOLDS.good) score = 0.75;
  else if (turnsPerNode <= EFFICIENCY_THRESHOLDS.fair) score = 0.5;
  else score = 0.25;

  return { score, totalTurns, duration, turnsPerNode };
}

// ─── Score Aggregation ──────────────────────────────────────────

/**
 * Computes the weighted Workflow Adherence score (0–100).
 *
 * @param {Object} scores - { completeness, ordering, quality, recovery } each 0.0–1.0
 * @returns {number} Rounded integer 0–100
 */
function computeAdherenceScore(scores) {
  return Math.round(
    Object.keys(ADHERENCE_WEIGHTS).reduce(
      (sum, key) => sum + scores[key] * ADHERENCE_WEIGHTS[key],
      0
    ) * 100
  );
}

/**
 * Computes the weighted Performance score (0–100).
 *
 * @param {Object} scores - { latency, efficiency } each 0.0–1.0
 * @returns {number} Rounded integer 0–100
 */
function computePerformanceScore(scores) {
  return Math.round(
    Object.keys(PERFORMANCE_WEIGHTS).reduce(
      (sum, key) => sum + scores[key] * PERFORMANCE_WEIGHTS[key],
      0
    ) * 100
  );
}

module.exports = {
  computeCompleteness,
  computeOrdering,
  computeQuality,
  computeRecovery,
  computeLatency,
  computeEfficiency,
  computeAdherenceScore,
  computePerformanceScore,
};
