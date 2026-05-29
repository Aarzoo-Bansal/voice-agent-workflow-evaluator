/**
 * Pass 3: Summarizer
 *
 * Takes computed scores and per-node details, then generates a
 * human-readable qualitative summary via an LLM call.
 *
 * Pipeline position:
 *   Transcript → Segmenter → NodeMapper → Scorer → [Summarizer]
 *
 * This is the final LLM pass. It uses free-form text output
 * (not structured JSON) because the result is a narrative summary
 * meant for human consumption — not downstream code.
 */

const { callLLM } = require('../llm/client');
const { LLM_CONFIG } = require('../config');
const { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } = require('../prompts/summary');

// ─── Summary Generation ─────────────────────────────────────────

/**
 * Generates a qualitative two-paragraph summary of the verification results.
 *
 * Paragraph 1: Workflow Adherence — which nodes were handled well,
 * which were missed or partial, off-workflow recovery details.
 *
 * Paragraph 2: Performance — latency issues, efficiency, timing spikes.
 *
 * @param {Object} results - Full verification results containing:
 * @param {number} results.adherenceScore       - Weighted adherence score (0–100)
 * @param {Object} results.adherenceScores      - { completeness, ordering, quality, recovery }
 * @param {number} results.performanceScore      - Weighted performance score (0–100)
 * @param {Object} results.performanceScores     - { latency, efficiency }
 * @param {Object[]} results.nodeResults         - Per-node results with quality criteria
 * @param {Object[]} results.offWorkflowSegments - Off-workflow segments with recovery criteria
 * @param {Object} results.latencyDetails        - { avg, max, violations }
 * @param {Object} results.efficiencyDetails     - { totalTurns, duration, turnsPerNode }
 * @returns {Promise<string>} Two-paragraph qualitative summary
 */
async function generateSummary(results) {
  const userPrompt = buildSummaryPrompt(results);

  const summary = await callLLM({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userPrompt,
    model: LLM_CONFIG.summaryModel,
  });

  return summary;
}

module.exports = {
  generateSummary,
};
