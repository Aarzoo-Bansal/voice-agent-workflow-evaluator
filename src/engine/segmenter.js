/**
 * Pass 1: Segmenter
 *
 * Takes a raw conversation transcript and groups consecutive turns
 * into logical topic segments using an LLM call.
 *
 * This is the first stage in the pipeline:
 *   Transcript → [Segmenter] → Segments → NodeMapper → Scorer
 *
 * The segmenter does NOT classify segments to workflow nodes.
 * Its only job is finding topic boundaries — keeping the task
 * focused improves LLM reliability.
 *
 * After the LLM returns segments, we validate them to catch
 * structural issues (gaps, overlaps, out-of-bounds indices)
 * before passing them downstream.
 */

const { callLLMStructured } = require('../llm/client');
const { LLM_CONFIG } = require('../config');
const {
  SEGMENTATION_SYSTEM_PROMPT,
  SEGMENTATION_SCHEMA,
  buildSegmentationPrompt,
} = require('../prompts/segmentation');

// ─── Validation ──────────────────────────────────────────────────

/**
 * Validates that the LLM-returned segments are structurally sound.
 *
 * Checks:
 *   1. Segments are non-empty
 *   2. First segment starts at turn 0
 *   3. Last segment ends at the final turn
 *   4. Segments are contiguous (no gaps or overlaps)
 *   5. All indices are within transcript bounds
 *   6. Each segment's start ≤ end
 *
 * @param {Object[]} segments   - Array of { segmentId, startTurnIndex, endTurnIndex, summary }
 * @param {number}   turnCount  - Total number of turns in the transcript
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateSegments(segments, turnCount) {
  const errors = [];

  if (!segments || segments.length === 0) {
    return { valid: false, errors: ['No segments returned'] };
  }

  // Sort by startTurnIndex to check contiguity
  const sorted = [...segments].sort((a, b) => a.startTurnIndex - b.startTurnIndex);

  // Check that first segment starts at 0
  if (sorted[0].startTurnIndex !== 0) {
    errors.push(`First segment starts at turn ${sorted[0].startTurnIndex}, expected 0`);
  }

  // Check that last segment ends at the final turn
  if (sorted[sorted.length - 1].endTurnIndex !== turnCount - 1) {
    errors.push(
      `Last segment ends at turn ${sorted[sorted.length - 1].endTurnIndex}, expected ${turnCount - 1}`
    );
  }

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];

    // Check bounds
    if (seg.startTurnIndex < 0 || seg.endTurnIndex >= turnCount) {
      errors.push(`Segment ${seg.segmentId} has out-of-bounds indices [${seg.startTurnIndex}, ${seg.endTurnIndex}]`);
    }

    // Check start ≤ end
    if (seg.startTurnIndex > seg.endTurnIndex) {
      errors.push(`Segment ${seg.segmentId} has start (${seg.startTurnIndex}) > end (${seg.endTurnIndex})`);
    }

    // Check contiguity with next segment
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (next.startTurnIndex !== seg.endTurnIndex + 1) {
        errors.push(
          `Gap or overlap between segment ${seg.segmentId} (ends ${seg.endTurnIndex}) and segment ${next.segmentId} (starts ${next.startTurnIndex})`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Repair ─────────────────────────────────────────────────────

/**
 * Attempts to auto-repair small gaps and boundary issues in LLM-returned segments.
 *
 * The LLM sometimes misaligns turn indices by 1–2 turns, especially on longer
 * or repetitive transcripts. Rather than hard-failing, we fix what we can:
 *   - Extend the previous segment's end to close small gaps (≤ 2 turns)
 *   - Fix the first segment to start at 0
 *   - Fix the last segment to end at the final turn
 *
 * @param {Object[]} segments  - Segments sorted by startTurnIndex
 * @param {number}   turnCount - Total number of turns in the transcript
 * @returns {Object[]} Repaired segments (mutated in place for simplicity)
 */
function repairSegments(segments, turnCount) {
  if (!segments || segments.length === 0) return segments;

  const sorted = segments.sort((a, b) => a.startTurnIndex - b.startTurnIndex);

  // Fix first segment start
  if (sorted[0].startTurnIndex !== 0) {
    console.warn(`  ⚠ Repaired: first segment started at ${sorted[0].startTurnIndex}, adjusted to 0`);
    sorted[0].startTurnIndex = 0;
  }

  // Fix last segment end
  if (sorted[sorted.length - 1].endTurnIndex !== turnCount - 1) {
    console.warn(`  ⚠ Repaired: last segment ended at ${sorted[sorted.length - 1].endTurnIndex}, adjusted to ${turnCount - 1}`);
    sorted[sorted.length - 1].endTurnIndex = turnCount - 1;
  }

  // Close small gaps between consecutive segments
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const gap = next.startTurnIndex - curr.endTurnIndex - 1;

    if (gap > 0 && gap <= 2) {
      // Small gap: extend current segment's end to cover the missing turns
      console.warn(`  ⚠ Repaired: gap of ${gap} turn(s) between segments ${curr.segmentId} and ${next.segmentId}, extending segment ${curr.segmentId}`);
      curr.endTurnIndex = next.startTurnIndex - 1;
    } else if (gap < 0) {
      // Overlap: trim the next segment's start
      console.warn(`  ⚠ Repaired: overlap of ${-gap} turn(s) between segments ${curr.segmentId} and ${next.segmentId}, adjusting segment ${next.segmentId}`);
      next.startTurnIndex = curr.endTurnIndex + 1;
    }
  }

  return sorted;
}

// ─── Segmentation ────────────────────────────────────────────────

/**
 * Segments a transcript into logical topic groups via LLM.
 *
 * @param {Object[]} transcript - Array of { role, content, beginning, end }
 * @returns {Promise<Object[]>} Validated array of segments with summaries
 * @throws {Error} If the LLM returns structurally invalid segments after repair
 */
async function segmentTranscript(transcript, workflowNodes) {
  const userPrompt = buildSegmentationPrompt(transcript, workflowNodes);

  const response = await callLLMStructured({
    systemPrompt: SEGMENTATION_SYSTEM_PROMPT,
    userPrompt,
    model: LLM_CONFIG.segmentationModel,
    schemaName: 'segmentation_response',
    schema: SEGMENTATION_SCHEMA,
  });

  let segments = response.segments;

  // Try to auto-repair small LLM indexing errors before validation
  segments = repairSegments(segments, transcript.length);

  // Validate structural integrity after repair
  const validation = validateSegments(segments, transcript.length);
  if (!validation.valid) {
    console.error('Segmentation validation errors (after repair):', validation.errors);
    throw new Error(
      `LLM returned invalid segments: ${validation.errors.join('; ')}`
    );
  }

  return segments;
}

module.exports = {
  segmentTranscript,
  validateSegments,
};
