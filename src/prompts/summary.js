/**
 * Pass 3: Summary Prompt
 *
 * Takes the computed scores, per-node results, and off-workflow details,
 * then asks the LLM to produce a human-readable two-paragraph summary.
 *
 * This is the only pass that uses free-form text output (not structured JSON),
 * because the output is meant for human consumption — a qualitative narrative
 * that references specific criteria, turn numbers, and timing data.
 *
 * Why not just template this?
 *   A template can report numbers, but can't synthesize insights like:
 *   "Urgency wasn't assessed, though this is less critical for a routine checkup."
 *   The LLM adds judgment and contextual nuance to the raw scores.
 */

// ─── System Prompt ───────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a workflow evaluation summarizer. Write a concise summary of a conversation agent's performance.

Write exactly two paragraphs:

1. Workflow Adherence: Which nodes were handled well, which were missed or partial, cite specific criteria (met and not met) and turn numbers. Mention off-workflow segments and how they were handled.

2. Performance: Latency issues (average, max, violations), efficiency (turns per node, total duration). Note any specific response time spikes.

Be specific. Reference criteria names, turn numbers, and timing data from the provided results. Do not use vague language like "generally good" — cite the evidence.`;

// ─── User Prompt Builder ─────────────────────────────────────────

/**
 * Builds the user prompt for Pass 3 by formatting all scoring results
 * into a structured text block the LLM can reference.
 *
 * @param {Object} params
 * @param {number} params.adherenceScore     - Weighted adherence score (0–100)
 * @param {Object} params.adherenceScores    - { completeness, ordering, quality, recovery } each 0.0–1.0
 * @param {number} params.performanceScore   - Weighted performance score (0–100)
 * @param {Object} params.performanceScores  - { latency, efficiency } each 0.0–1.0
 * @param {Object[]} params.nodeResults      - Per-node results with quality criteria
 * @param {Object[]} params.offWorkflowSegments - Off-workflow segments with recovery criteria
 * @param {Object} params.latencyDetails     - { avg, max, violations }
 * @param {Object} params.efficiencyDetails  - { totalTurns, duration, turnsPerNode }
 * @returns {string} Formatted user prompt
 */
function buildSummaryPrompt({
  adherenceScore,
  adherenceScores,
  performanceScore,
  performanceScores,
  nodeResults,
  offWorkflowSegments,
  latencyDetails,
  efficiencyDetails,
}) {
  // Format per-node results
  const nodeSection = nodeResults
    .map((node) => {
      let detail = `Node ${node.nodeId} "${node.label}" [${node.type}]: status=${node.status}`;

      if (node.quality) {
        detail += `, quality=${node.quality} (${node.qualityExplanation})`;
      }

      if (node.qualityCriteria) {
        const met = node.qualityCriteria.met
          .map((c) => `    + ${c.criterion}: ${c.evidence}`)
          .join('\n');
        const notMet = node.qualityCriteria.not_met
          .map((c) => `    - ${c.criterion}: ${c.reason}`)
          .join('\n');
        if (met) detail += `\n  Met:\n${met}`;
        if (notMet) detail += `\n  Not met:\n${notMet}`;
      }

      if (node.turns && node.turns.length > 0) {
        detail += `\n  Turns: ${node.turns.join(', ')}`;
      }

      return detail;
    })
    .join('\n\n');

  // Format off-workflow segments
  const offWorkflowSection = offWorkflowSegments.length > 0
    ? offWorkflowSegments
        .map((seg) => {
          let detail = `Segment ${seg.segmentId}: recovery=${seg.recovery} (turns ${seg.turns.join(', ')})`;

          if (seg.recoveryCriteria) {
            const met = seg.recoveryCriteria.met
              .map((c) => `    + ${c.criterion}: ${c.evidence}`)
              .join('\n');
            const notMet = seg.recoveryCriteria.not_met
              .map((c) => `    - ${c.criterion}: ${c.reason}`)
              .join('\n');
            if (met) detail += `\n  Met:\n${met}`;
            if (notMet) detail += `\n  Not met:\n${notMet}`;
          }

          return detail;
        })
        .join('\n\n')
    : 'None';

  return `SCORES:
Workflow Adherence: ${adherenceScore}/100
  Completeness: ${adherenceScores.completeness.toFixed(2)}
  Ordering: ${adherenceScores.ordering.toFixed(2)}
  Quality: ${adherenceScores.quality.toFixed(2)}
  Recovery: ${adherenceScores.recovery.toFixed(2)}

Performance: ${performanceScore}/100
  Latency: ${performanceScores.latency.toFixed(2)}
  Efficiency: ${performanceScores.efficiency.toFixed(2)}

NODE RESULTS:
${nodeSection}

OFF-WORKFLOW SEGMENTS:
${offWorkflowSection}

LATENCY DETAILS:
  Average: ${latencyDetails.avg.toFixed(2)}s
  Max: ${latencyDetails.max.toFixed(2)}s
  Violations (>10s): ${latencyDetails.violations}

EFFICIENCY DETAILS:
  Total turns: ${efficiencyDetails.totalTurns}
  Duration: ${efficiencyDetails.duration.toFixed(2)}s
  Turns per required node: ${efficiencyDetails.turnsPerNode.toFixed(1)}`;
}

module.exports = {
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
};
