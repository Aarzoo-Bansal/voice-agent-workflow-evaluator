/**
 * Pass 2: Node Mapper
 *
 * Takes segments from Pass 1 and classifies each one to workflow
 * node(s) via parallelized LLM calls (one call per segment).
 *
 * Pipeline position:
 *   Transcript → Segmenter → [NodeMapper] → Scorer
 *
 * Each segment is independently classified, which enables:
 *   - Parallelization via Promise.all (all calls fire at once)
 *   - Isolated failures (one bad classification doesn't poison others)
 *   - Context windowing (each call gets previous segment's summary)
 *
 * Post-processing:
 *   - Flags low-confidence mappings as needs_review
 *   - Attaches turn indices from the original segment
 */

const { callLLMStructured } = require('../llm/client');
const { LLM_CONFIG, CONFIDENCE_THRESHOLD } = require('../config');
const {
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_SCHEMA,
  buildClassificationPrompt,
} = require('../prompts/classification');


/**
 * Normalizes node IDs returned by the LLM.
 *
 * The LLM sometimes returns "Node 1" or " 2 " instead of clean "1".
 * This strips the "Node" prefix and trims whitespace so IDs match
 * the workflow graph exactly. "off_workflow" is passed through as-is.
 *
 * @param {string[]} nodeIds - Raw node IDs from the LLM response
 * @returns {string[]} Cleaned node IDs matching the graph format
 */
function normalizeNodeIds(nodeIds) {
  return nodeIds.map((id) => {
    if (id === 'off_workflow') return id;
    return id.replace(/^Node\s+/i, '').trim();
  });
}

// ─── Single Segment Classification ──────────────────────────────

/**
 * Classifies a single segment against the workflow nodes.
 *
 * @param {Object}   segment       - Segment from Pass 1 { segmentId, startTurnIndex, endTurnIndex, summary }
 * @param {string}   prevSummary   - Previous segment's summary for context windowing
 * @param {Object[]} transcript    - Full conversation transcript
 * @param {Object[]} workflowNodes - Workflow graph nodes with descriptions
 * @returns {Promise<Object>} Classification result with nodeIds, quality, recovery, etc.
 */
async function classifySegment(segment, prevSummary, transcript, workflowNodes) {
  const userPrompt = buildClassificationPrompt(
    segment,
    prevSummary,
    transcript,
    workflowNodes
  );

  const result = await callLLMStructured({
    systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
    userPrompt,
    model: LLM_CONFIG.classificationModel,
    schemaName: 'classification_response',
    schema: CLASSIFICATION_SCHEMA,
  });

  // Normalize node IDs — LLM sometimes returns "Node 1" instead of "1"
  result.nodeIds = normalizeNodeIds(result.nodeIds);

  // Flag low-confidence results for human review
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    result.needsReview = true;
  }

  // Attach segment metadata for downstream traceability
  result.segmentId = segment.segmentId;
  result.startTurnIndex = segment.startTurnIndex;
  result.endTurnIndex = segment.endTurnIndex;

  return result;
}

// ─── Parallel Segment Classification ─────────────────────────────

/**
 * Classifies all segments in parallel via Promise.all.
 *
 * Each call receives the previous segment's summary for context
 * windowing. The first segment gets "None" as its context.
 *
 * Why Promise.all and not sequential?
 *   - Each segment's classification is independent
 *   - Context windowing only uses the previous *summary* (already available from Pass 1)
 *   - N parallel calls ≈ same wall-clock time as 1 call
 *
 * @param {Object[]} segments      - Segments from Pass 1
 * @param {Object[]} transcript    - Full conversation transcript
 * @param {Object[]} workflowNodes - Workflow graph nodes with descriptions
 * @returns {Promise<Object[]>} Array of classification results, one per segment
 */
async function mapSegmentsToNodes(segments, transcript, workflowNodes) {
  const classificationPromises = segments.map((segment, index) => {
    const prevSummary = index === 0
      ? 'None (this is the first segment)'
      : segments[index - 1].summary;

    return classifySegment(segment, prevSummary, transcript, workflowNodes);
  });

  const results = await Promise.all(classificationPromises);

  return results;
}

module.exports = {
  classifySegment,
  mapSegmentsToNodes,
};
