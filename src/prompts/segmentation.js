/**
 * Pass 1: Segmentation Prompt
 *
 * Groups consecutive transcript turns into logical topic segments.
 * This pass does NOT classify segments to workflow nodes — that's Pass 2.
 *
 * Why a separate pass?
 *   Single-call risk: asking an LLM to segment + classify + rate quality
 *   in one call leads to hallucinations, especially toward the end
 *   ("lost in the middle" problem). Keeping segmentation focused on one
 *   job — finding topic boundaries — makes it reliable.
 *
 * Mitigations for single-point-of-failure risk:
 *   1. Task is narrow (just find boundaries, not classify)
 *   2. Summary per segment forces the LLM to reason about content
 *   3. Multi-label support in Pass 2 compensates imprecise boundaries
 *   4. Confidence threshold in Pass 2 catches downstream uncertainty
 */

// ─── System Prompt ───────────────────────────────────────────────

const SEGMENTATION_SYSTEM_PROMPT = `You are a conversation analyst. Segment this transcript so that each segment corresponds to one execution of a single workflow node (or is off-workflow).

You will be given the workflow nodes below. Your job is to find boundaries in the transcript where the agent transitions from one workflow node to another.

Rules:
- Consecutive turns only (no gaps, no reordering)
- Every turn must belong to exactly one segment
- Segments must cover the entire transcript (no turns left out)
- Use 0-based turn indices matching the transcript array positions
- Include a 1-sentence summary per segment

How to segment:
- Each segment should capture all the turns where the agent is working on ONE execution of ONE workflow node.
- If multiple back-and-forth turns all serve the same node's purpose (e.g., 5 turns of gathering diagnostic info), keep them in ONE segment.
- Only split when the conversation transitions to a different node's concern (e.g., from diagnosing to attempting a fix, or from fixing to wrapping up).

Handling loops (repeated visits to the same node):
- If the workflow has loops (e.g., diagnose → fix → diagnose → fix), each pass through a node is a SEPARATE segment.
- Example: diagnose issue #1 = segment A, attempt fix #1 = segment B, diagnose issue #2 = segment C, attempt fix #2 = segment D. That's 4 segments, not 2.

Off-workflow detection:
- If a span of turns doesn't correspond to any workflow node (e.g., user complaint, tangent, unrelated question), mark it as its own segment.

The typical number of segments should roughly match the number of node transitions in the conversation — usually 5-15 segments for a full conversation, not one segment per turn.`;
// ─── Structured Output Schema ────────────────────────────────────

/**
 * JSON Schema for the segmentation response.
 * Enforced at the API level via OpenAI's structured output mode.
 *
 * Each segment has:
 *   - segmentId:      Sequential identifier (1-based)
 *   - startTurnIndex: First turn index in this segment (0-based, inclusive)
 *   - endTurnIndex:   Last turn index in this segment (0-based, inclusive)
 *   - summary:        One-sentence description of what this segment covers
 */
const SEGMENTATION_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          segmentId: {
            type: 'number',
            description: 'Sequential segment identifier, starting at 1',
          },
          startTurnIndex: {
            type: 'number',
            description: 'Index of the first turn in this segment (0-based, inclusive)',
          },
          endTurnIndex: {
            type: 'number',
            description: 'Index of the last turn in this segment (0-based, inclusive)',
          },
          summary: {
            type: 'string',
            description: 'One-sentence summary of this segment\'s topic or purpose',
          },
        },
        required: ['segmentId', 'startTurnIndex', 'endTurnIndex', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['segments'],
  additionalProperties: false,
};

// ─── User Prompt Builder ─────────────────────────────────────────

/**
 * Builds the user prompt for Pass 1 by formatting the transcript
 * into a numbered, readable format the LLM can reference.
 *
 * @param {Object[]} transcript - Array of { role, content, beginning, end }
 * @returns {string} Formatted user prompt with the full transcript
 */
function buildSegmentationPrompt(transcript, workflowNodes) {
  const nodesText = workflowNodes
    .map((n) => {
      const label = n.data?.label || n.label || n.id;
      const desc = n.data?.description || n.description || '';
      return `Node ${n.id} [${n.type}] "${label}": ${desc}`;
    })
    .join('\n');

  const formattedTurns = transcript
    .map((turn, i) => `[Turn ${i}] ${turn.role}: ${turn.content}`)
    .join('\n');

  return `WORKFLOW NODES:
${nodesText}

TRANSCRIPT:
${formattedTurns}

Segment the transcript so each segment maps to exactly one execution of one workflow node (or is off-workflow). Group all turns that serve the same node together — only split at node transitions.`;
}

module.exports = {
  SEGMENTATION_SYSTEM_PROMPT,
  SEGMENTATION_SCHEMA,
  buildSegmentationPrompt,
};
