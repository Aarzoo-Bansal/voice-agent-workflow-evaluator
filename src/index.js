/**
 * Workflow Verification Engine — Orchestrator
 *
 * Ties the full pipeline together:
 *
 *   INPUTS (graph + transcript)
 *     │
 *     ▼
 *   STAGE 1: Segmentation (LLM Pass 1)
 *     Group turns into topic segments
 *     │
 *     ▼
 *   STAGE 2: Node Mapping (LLM Pass 2, parallelized)
 *     Classify each segment → node(s) or off_workflow
 *     │
 *     ▼
 *   STAGE 3: Scoring (deterministic, no LLM)
 *     Workflow Adherence + Performance scores
 *     │
 *     ▼
 *   STAGE 4: Qualitative Summary (LLM Pass 3)
 *     Human-readable explanation
 *     │
 *     ▼
 *   OUTPUT (JSON result file)
 *
 * Usage:
 *   node src/index.js
 *   node src/index.js --graph data/custom-graph.json --transcript data/custom-transcript.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { segmentTranscript } = require('./engine/segmenter');
const { mapSegmentsToNodes } = require('./engine/nodeMapper');
const {
  computeCompleteness,
  computeOrdering,
  computeQuality,
  computeRecovery,
  computeLatency,
  computeEfficiency,
  computeAdherenceScore,
  computePerformanceScore,
} = require('./engine/scorer');
const { getAllPaths, findBestMatchingPath } = require('./engine/graphUtils');
const { generateSummary } = require('./engine/summarizer');
const { extractCriteriaForGraph } = require('./engine/criteriaExtractor');
const { CONFIDENCE_THRESHOLD } = require('./config');

// ─── CLI Argument Parsing ────────────────────────────────────────

/**
 * Parses --graph and --transcript flags from command line args.
 * Falls back to example data if no flags provided.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let graphPath = path.join(__dirname, '..', 'data/test-graph1', 'graph.json');
  let transcriptPath = path.join(__dirname, '..', 'data/test-graph1', 'transcript-01-missed-node.json');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--graph' && args[i + 1]) {
      graphPath = path.resolve(args[i + 1]);
      i++;
    }
    if (args[i] === '--transcript' && args[i + 1]) {
      transcriptPath = path.resolve(args[i + 1]);
      i++;
    }
  }

  return { graphPath, transcriptPath };
}

// ─── Criteria Merging ───────────────────────────────────────────

/**
 * Merges qualityCriteria across multiple segment classifications for
 * the same node. A criterion counts as "met" if ANY segment met it.
 * This prevents penalizing agents for splitting work across segments.
 *
 * @param {Object[]} classifications - All classifications for a single node
 * @returns {Object} { met: [...], not_met: [...] }
 */
function mergeCriteriaAcrossVisits(classifications) {
  const metMap = new Map();    // criterion name → { criterion, evidence }
  const notMetMap = new Map(); // criterion name → { criterion, reason }

  for (const c of classifications) {
    const criteria = c.qualityCriteria;
    if (!criteria) continue;

    for (const item of (criteria.met || [])) {
      // If this criterion was met in any segment, it's met
      metMap.set(item.criterion, item);
    }
    for (const item of (criteria.not_met || [])) {
      // Only add to not_met if not already met in another segment
      if (!metMap.has(item.criterion)) {
        notMetMap.set(item.criterion, item);
      }
    }
  }

  // Remove from not_met anything that was met in a later segment
  for (const key of metMap.keys()) {
    notMetMap.delete(key);
  }

  return {
    met: [...metMap.values()],
    not_met: [...notMetMap.values()],
  };
}

// ─── Result Assembly ─────────────────────────────────────────────

/**
 * Builds per-node results by combining workflow graph node metadata
 * with classification results from Pass 2.
 *
 * Nodes that were visited get their quality, criteria, and turns.
 * Nodes on the best matching path that weren't visited get "skipped".
 * Nodes not on the best path get "not_needed".
 *
 * @param {Object}   workflowGraph - Workflow graph with nodes and edges
 * @param {Object[]} agentPath     - Classification results from Pass 2
 * @returns {Object} { nodeResults, offWorkflowSegments, bestMatchingPath, visitedPath }
 */
function assembleNodeResults(workflowGraph, agentPath) {
  // Determine the best matching path for context
  const allPaths = getAllPaths(workflowGraph);
  const visitedNodeIds = [
    ...new Set(
      agentPath
        .filter((m) => !m.nodeIds.includes('off_workflow'))
        .flatMap((m) => m.nodeIds)
    ),
  ];
  const bestPath = findBestMatchingPath(allPaths, visitedNodeIds);

  // Build a lookup: nodeId → all classification results (supports loops/repeated visits)
  // When turnBreakdown is available, attach per-node turns so downstream only counts
  // the turns that actually belong to each node (not the entire segment).
  const classificationsByNode = {};
  for (const mapping of agentPath) {
    if (mapping.nodeIds.includes('off_workflow')) continue;
    for (const nodeId of mapping.nodeIds) {
      if (!classificationsByNode[nodeId]) {
        classificationsByNode[nodeId] = [];
      }
      // Attach node-specific turns from turnBreakdown if available
      const breakdown = mapping.turnBreakdown?.find((tb) => tb.nodeId === nodeId);
      const enrichedMapping = {
        ...mapping,
        nodeTurns: breakdown?.turns || generateTurnRange(mapping.startTurnIndex, mapping.endTurnIndex),
      };
      classificationsByNode[nodeId].push(enrichedMapping);
    }
  }

  // Build chronological visit sequence (preserves loops and off-workflow interleaving)
  // Multi-label segments (one segment → multiple nodes) get a single entry with the primary node label.
  const visitSequence = agentPath.map((mapping) => {
    const turns = generateTurnRange(mapping.startTurnIndex, mapping.endTurnIndex);
    if (mapping.nodeIds.includes('off_workflow')) {
      return {
        type: 'off_script',
        segmentId: mapping.segmentId,
        label: 'Off-script',
        turns,
        recovery: mapping.recovery,
      };
    }
    const labels = mapping.nodeIds.map((id) => {
      const graphNode = workflowGraph.nodes.find((n) => n.id === id);
      return graphNode?.data?.label || graphNode?.label || id;
    });
    return {
      type: 'node',
      nodeId: mapping.nodeIds[0],
      nodeIds: mapping.nodeIds,
      label: labels.join(' + '),
      turns,
    };
  });

  // Build per-node results
  const nodeResults = workflowGraph.nodes.map((node) => {
    const label = node.data?.label || node.label || node.id;
    const classifications = classificationsByNode[node.id];
    const isOnBestPath = bestPath.includes(node.id);

    if (classifications && classifications.length > 0) {
      // Use the best quality classification for the summary, but merge all turns.
      // Prefer nodeTurns (from turnBreakdown) over full segment range.
      const allTurns = [...new Set(
        classifications.flatMap((c) => c.nodeTurns)
      )].sort((a, b) => a - b);
      const bestClassification = classifications.reduce((best, c) => {
        const rank = { full: 2, partial: 1, none: 0 };
        return (rank[c.quality] || 0) >= (rank[best.quality] || 0) ? c : best;
      }, classifications[0]);

      // Count real loops: only count a visit if there's a different node's segment in between.
      // Consecutive or overlapping segments for the same node = 1 visit, not multiple.
      const sortedClassifications = [...classifications].sort(
        (a, b) => a.startTurnIndex - b.startTurnIndex
      );
      let realVisitCount = 1;
      for (let ci = 1; ci < sortedClassifications.length; ci++) {
        const prev = sortedClassifications[ci - 1];
        const curr = sortedClassifications[ci];
        // Check if there's a segment for a DIFFERENT node between prev and curr
        const hasInterveningNode = agentPath.some(
          (m) =>
            !m.nodeIds.includes('off_workflow') &&
            !m.nodeIds.includes(node.id) &&
            m.startTurnIndex >= prev.startTurnIndex &&
            m.startTurnIndex < curr.startTurnIndex
        );
        if (hasInterveningNode) realVisitCount++;
      }

      // Build per-visit breakdown — preserves each visit's quality and turns
      // so the UI can show the full story when a node is visited multiple times.
      // Uses nodeTurns (from turnBreakdown) for accurate per-node attribution.
      const visits = classifications.map((c) => ({
        quality: c.quality,
        qualityScore: c.quality ? { full: 1.0, partial: 0.5, none: 0.0 }[c.quality] : null,
        turns: c.nodeTurns,
        qualityCriteria: c.qualityCriteria,
        qualityExplanation: c.justification,
        confidence: c.confidence,
        segmentId: c.segmentId,
      }));

      // Merge criteria across all segments for this node.
      // A criterion counts as "met" if ANY segment met it — the agent may have
      // fulfilled different criteria at different points in the conversation.
      const mergedCriteria = mergeCriteriaAcrossVisits(classifications);
      const mergedMetCount = mergedCriteria.met.length;
      const mergedNotMetCount = mergedCriteria.not_met.length;
      const mergedTotal = mergedMetCount + mergedNotMetCount;
      const mergedQuality = mergedNotMetCount === 0 ? 'full'
        : mergedMetCount === 0 ? 'none'
        : 'partial';
      const mergedQualityScore = mergedTotal > 0 ? mergedMetCount / mergedTotal : null;

      // Node was visited by the agent
      return {
        nodeId: node.id,
        label,
        type: node.type,
        status: 'visited',
        visitCount: realVisitCount,
        quality: mergedQuality,
        qualityScore: mergedQualityScore,
        qualityExplanation: bestClassification.justification,
        qualityCriteria: mergedCriteria,
        confidence: bestClassification.confidence,
        needsReview: bestClassification.needsReview || false,
        turns: allTurns,
        visits,
      };
    } else if (isOnBestPath) {
      // Node was required but skipped
      return {
        nodeId: node.id,
        label,
        type: node.type,
        status: 'skipped',
        quality: null,
        qualityScore: null,
        qualityExplanation: 'Node was on the expected path but not visited',
        qualityCriteria: null,
        confidence: null,
        needsReview: false,
        turns: [],
      };
    } else {
      // Node is not on the agent's path (e.g., other branch)
      return {
        nodeId: node.id,
        label,
        type: node.type,
        status: 'not_needed',
        quality: null,
        qualityScore: null,
        qualityExplanation: "Not on the agent's path — conditional node",
        qualityCriteria: null,
        confidence: null,
        needsReview: false,
        turns: [],
      };
    }
  });

  // Collect off-workflow segments
  const offWorkflowSegments = agentPath
    .filter((m) => m.nodeIds.includes('off_workflow'))
    .map((m) => ({
      segmentId: m.segmentId,
      turns: generateTurnRange(m.startTurnIndex, m.endTurnIndex),
      recovery: m.recovery,
      recoveryScore: m.recovery
        ? { graceful: 1.0, adequate: 0.5, poor: 0.0 }[m.recovery]
        : null,
      recoveryCriteria: m.recoveryCriteria,
    }));

  return {
    nodeResults,
    offWorkflowSegments,
    bestMatchingPath: bestPath,
    visitedPath: visitedNodeIds,
    visitSequence,
  };
}

/**
 * Generates an array of turn indices from start to end (inclusive).
 *
 * @param {number} start - Start turn index
 * @param {number} end   - End turn index
 * @returns {number[]} Array of indices [start, start+1, ..., end]
 */
function generateTurnRange(start, end) {
  const range = [];
  for (let i = start; i <= end; i++) {
    range.push(i);
  }
  return range;
}

// ─── Main Pipeline ───────────────────────────────────────────────

/**
 * Runs the full verification pipeline.
 *
 * @param {Object}   workflowGraph - Workflow graph with nodes and edges
 * @param {Object[]} transcript    - Conversation transcript
 * @returns {Promise<Object>} Complete verification result
 */
async function runPipeline(workflowGraph, transcript) {
  // ── Stage 1: Segmentation ──
  console.log('Stage 1: Segmenting transcript...');
  const segments = await segmentTranscript(transcript, workflowGraph.nodes);
  fs.writeFileSync('output/debug-segments.json', JSON.stringify(segments, null, 2));
  console.log(`  → Wrote ${segments.length} segments to output/debug-segments.json`);
  console.log(`  → ${segments.length} segments identified`);

  // ── Stage 2: Node Mapping ──
  console.log('Stage 2: Classifying segments to nodes...');
  const agentPath = await mapSegmentsToNodes(segments, transcript, workflowGraph.nodes);
  fs.writeFileSync('output/debug-mappings.json', JSON.stringify(agentPath, null, 2));
  console.log(`  → Wrote ${agentPath.length} mappings to output/debug-mappings.json`);
  console.log(`  → ${agentPath.length} segments classified`);

  // ── Stage 3: Scoring ──
  console.log('Stage 3: Computing scores...');

  const completeness = computeCompleteness(agentPath, workflowGraph);
  const ordering = computeOrdering(agentPath, workflowGraph);
  const quality = computeQuality(agentPath);
  const recovery = computeRecovery(agentPath);

  const adherenceScores = { completeness, ordering, quality, recovery };
  const adherenceScore = computeAdherenceScore(adherenceScores);

  const latencyResult = computeLatency(transcript);
  const efficiencyResult = computeEfficiency(transcript, agentPath, workflowGraph);

  const performanceScores = {
    latency: latencyResult.score,
    efficiency: efficiencyResult.score,
  };
  const performanceScore = computePerformanceScore(performanceScores);

  console.log(`  → Adherence: ${adherenceScore}/100, Performance: ${performanceScore}/100`);

  // ── Assemble per-node results ──
  const {
    nodeResults,
    offWorkflowSegments,
    bestMatchingPath,
    visitedPath,
    visitSequence,
  } = assembleNodeResults(workflowGraph, agentPath);

  const needsReviewCount = agentPath.filter((m) => m.needsReview).length;

  // ── Stage 4: Qualitative Summary ──
  console.log('Stage 4: Generating qualitative summary...');

  const latencyDetails = {
    avg: latencyResult.avg,
    max: latencyResult.max,
    violations: latencyResult.violations,
  };
  const efficiencyDetails = {
    totalTurns: efficiencyResult.totalTurns,
    duration: efficiencyResult.duration,
    turnsPerNode: efficiencyResult.turnsPerNode,
  };

  const qualitativeSummary = await generateSummary({
    adherenceScore,
    adherenceScores,
    performanceScore,
    performanceScores,
    nodeResults,
    offWorkflowSegments,
    latencyDetails,
    efficiencyDetails,
  });

  console.log('  → Summary generated');

  // ── Assemble final output ──
  return {
    workflow_adherence_score: adherenceScore,
    adherence_scores: adherenceScores,
    performance_score: performanceScore,
    performance_scores: performanceScores,
    needs_review_count: needsReviewCount,
    best_matching_path: bestMatchingPath,
    visited_path: visitedPath,
    visit_sequence: visitSequence,
    segments,
    latency_details: {
      avg_seconds: parseFloat(latencyResult.avg.toFixed(2)),
      max_seconds: parseFloat(latencyResult.max.toFixed(2)),
      violations_over_10s: latencyResult.violations,
    },
    efficiency_details: {
      total_turns: efficiencyResult.totalTurns,
      duration_seconds: parseFloat(efficiencyResult.duration.toFixed(2)),
      turns_per_required_node: parseFloat(efficiencyResult.turnsPerNode.toFixed(1)),
    },
    node_results: nodeResults,
    off_workflow_segments: offWorkflowSegments,
    qualitative_summary: qualitativeSummary,
  };
}

// ─── Entry Point ─────────────────────────────────────────────────

async function main() {
  const { graphPath, transcriptPath } = parseArgs();

  console.log(`Loading graph: ${graphPath}`);
  console.log(`Loading transcript: ${transcriptPath}`);

  const workflowGraph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));

  console.log(`Graph: ${workflowGraph.nodes.length} nodes, ${workflowGraph.edges.length} edges`);
  console.log(`Transcript: ${transcript.length} turns\n`);

  // Extract criteria before running the pipeline
  console.log('Extracting criteria from node descriptions...');
  const enrichedGraph = await extractCriteriaForGraph(workflowGraph);
  console.log(`  → Criteria extracted for ${enrichedGraph.nodes.filter(n => n.data?.criteria?.length > 0).length} nodes\n`);

  const result = await runPipeline(enrichedGraph, transcript);

  // Save output
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const inputName = path.basename(transcriptPath, path.extname(transcriptPath)).replace('-transcript', '');
  const outputPath = path.join(outputDir, `${inputName}-result.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  // Print summary to console
  console.log('\n' + '='.repeat(60));
  console.log(`Workflow Adherence: ${result.workflow_adherence_score}/100`);
  console.log(`Performance:        ${result.performance_score}/100`);
  console.log('='.repeat(60));
  console.log(`\n${result.qualitative_summary}`);
}

// Run if executed directly (not imported)
if (require.main === module) {
  main().catch((err) => {
    console.error('Pipeline failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runPipeline, assembleNodeResults };
