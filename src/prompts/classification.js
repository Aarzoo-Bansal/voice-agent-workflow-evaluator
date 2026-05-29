/**
 * Pass 2: Classification Prompt
 *
 * Classifies each conversation segment to workflow node(s) and rates quality.
 * One LLM call per segment, parallelized via Promise.all.
 *
 * Each call receives:
 *   - The current segment's turns
 *   - Previous segment's summary (context windowing)
 *   - All workflow node descriptions with types
 *
 * Reliability features:
 *   - Structured output: JSON schema enforcement, not prompt-based
 *   - Type-aware quality: Different criteria for start/decision/process/end nodes
 *   - Few-shot examples: Concrete examples for each quality and recovery rating
 *   - Confidence threshold: Low confidence → needs_review flag
 *   - Multi-label: Up to 2 nodes per segment when it straddles a boundary
 */

const { CONFIDENCE_THRESHOLD } = require('../config');

// ─── System Prompt ───────────────────────────────────────────────

const CLASSIFICATION_SYSTEM_PROMPT = `You are a workflow compliance analyst. Given a conversation segment and workflow node descriptions, determine which node(s) the segment corresponds to.

Rules:
- Match on INTENT and CONTENT, not exact wording
- If no workflow node matches → use "off_workflow"
- If the segment spans two steps → return both node IDs (max 2) AND specify the boundary via turnBreakdown
- Confidence 0.0 to 1.0
- IMPORTANT: Return ONLY the numeric node ID (e.g., "1", "2", "3"), NOT "Node 1" or "Node 2". The nodeIds must exactly match the id field from the workflow nodes provided below.

CRITICAL — "doing" vs "talking about":
- A segment matches a node only if the agent is FULFILLING that node's described purpose. Check the node description to understand what "doing" means for that specific node.
- If a node's purpose IS to explain or educate (e.g., "Explain how the process works", "Describe the policy"), then explaining IS performing the step — classify as that node.
- But if a node's purpose is an ACTION (e.g., "Collect name and DOB", "Schedule appointment") and the agent is only talking about that action without actually doing it (e.g., describing how scheduling works to reassure a frustrated customer), that is NOT performing the step — classify as off_workflow.
- The test: does this segment ADVANCE the workflow by fulfilling the node's criteria, or is the agent just referencing the topic in a different context (reassuring, explaining process to a confused customer, answering meta-questions)?
- Consider the previous segment context: if the previous segment was off_workflow and the agent appears to still be calming/reassuring the customer, the current segment is likely continued recovery — not a new workflow step — unless you can see the agent actively moving forward on a node's criteria.

CRITICAL — CRITERIA EXTRACTION:
- Extract EACH distinct action, question, or requirement from the node description as a SEPARATE criterion. Do NOT combine multiple requirements into one.
- If the description says "Ask for full name, date of birth, and contact number", that is 3 separate criteria, not 1.
- If the description says "Summarize details, offer optional reminders. Close: 'Thank you for scheduling...'", that is at least 3 separate criteria: summarize details, offer reminders, closing with follow-up.
- Count the distinct actions/items in the description. Your criteria list must have at least that many entries across met + not_met combined.

CRITICAL — EVALUATE THE AGENT, NOT THE USER:
- Quality is based ONLY on what the ASSISTANT said and did, not the user's responses.
- The user saying "Thanks, bye" does not count as the agent summarizing details or offering follow-up.
- Only credit criteria that the ASSISTANT actively fulfilled through their own words and actions.

QUALITY ASSESSMENT based on node type:
Extract criteria from the node description, then check each one.

For START nodes: Check greeting, self-identification, opening question.
For DECISION nodes: List each piece of information to gather from the description. Check if each was gathered.
For PROCESS nodes: List each action to perform from the description. Check if each was completed.
For END nodes: Check summary of details, confirmation, follow-up offer, closing.

Return qualityCriteria with "met" and "not_met" arrays.
Each "met" item has a criterion name + evidence (quote or turn number).
Each "not_met" item has a criterion name + reason why it wasn't fulfilled.

Quality rating:
- "full": ALL criteria from the node description were met. The not_met array MUST be empty for a "full" rating.
- "partial": SOME criteria met, at least one not met
- "none": Topic was touched but the node's purpose was not meaningfully served

WHEN PRE-DEFINED CRITERIA ARE PROVIDED:
- If a node lists "Criteria to check:", use EXACTLY those criteria for your quality assessment.
- Do NOT invent additional criteria beyond what is listed.
- Do NOT merge or rephrase the provided criteria.
- Each provided criterion must appear in either the "met" or "not_met" array, UNLESS it is a conditional criterion whose condition was not met (see below).
- The criterion names in your response must match the provided criteria verbatim.

CONDITIONAL CRITERIA:
- Some criteria include a condition in parentheses, e.g., "Do X (only if Y)" or "Do X (if Y)".
- First, determine from the conversation whether the condition applies.
- If the condition APPLIES → evaluate the criterion normally (place in "met" or "not_met").
- If the condition DOES NOT APPLY → SKIP the criterion entirely. Do NOT include it in either "met" or "not_met".
- Skipped conditional criteria do not count toward the total — they are excluded from scoring.

SELF-CHECK before returning quality:
1. Count how many criteria apply to this conversation (excluding conditional criteria whose conditions were not met).
2. Verify your met + not_met lists together cover ALL applicable criteria.
3. If not_met has ANY entries → quality CANNOT be "full".
4. If met is empty or nearly empty → quality should be "none", not "partial".

RECOVERY ASSESSMENT (off_workflow segments only):
Evaluate how the agent handled the off-workflow detour.

Return recoveryCriteria with "met" and "not_met" arrays.

Recovery rating:
- "graceful": Acknowledged concern, showed empathy, provided useful info, redirected back to workflow
- "adequate": Brief acknowledgment, redirected relatively quickly
- "poor": Dismissed concern, no empathy, failed to redirect

EXAMPLES:

Quality "full" on a decision node:
  The node description lists 4 information items to gather.
  All 4 were gathered during the conversation segment.
  qualityCriteria: {
    met: [
      { criterion: "[first item from description]", evidence: "[quote or turn reference]" },
      { criterion: "[second item from description]", evidence: "[quote or turn reference]" },
      { criterion: "[third item from description]", evidence: "[quote or turn reference]" },
      { criterion: "[fourth item from description]", evidence: "[quote or turn reference]" }
    ],
    not_met: []
  }

Quality "partial" on a process node:
  The node description lists 3 actions to perform.
  2 were completed, 1 was missed.
  qualityCriteria: {
    met: [
      { criterion: "[completed action from description]", evidence: "[turn reference]" },
      { criterion: "[completed action from description]", evidence: "[turn reference]" }
    ],
    not_met: [
      { criterion: "[missed action from description]", reason: "[why it wasn't done]" }
    ]
  }

Quality "partial" on an end node:
  The node description says "Summarize details, offer optional reminders. Close: 'Thank you for scheduling with NexaCare. Is there anything else I can help with today?'"
  That is 3 criteria: summarize details, offer reminders, closing with follow-up question.
  Agent only said "You're all set. Goodbye!"
  qualityCriteria: {
    met: [
      { criterion: "Closing statement", evidence: "Agent said goodbye (turn 8)" }
    ],
    not_met: [
      { criterion: "Summarize appointment details", reason: "Agent did not recap date, time, provider, or any details" },
      { criterion: "Offer optional reminders", reason: "Agent never mentioned reminders" }
    ]
  }
  NOTE: not_met is non-empty → quality MUST be "partial", not "full".

Recovery "graceful":
  The agent acknowledged the user's concern, showed empathy,
  provided helpful information, and smoothly redirected back
  to the workflow.
  recoveryCriteria: {
    met: [
      { criterion: "Acknowledged concern", evidence: "[turn reference]" },
      { criterion: "Showed empathy", evidence: "[turn reference]" },
      { criterion: "Redirected to workflow", evidence: "[turn reference]" }
    ],
    not_met: []
  }

Recovery "poor":
  The agent dismissed the concern without acknowledgment.
  recoveryCriteria: {
    met: [],
    not_met: [
      { criterion: "No acknowledgment", reason: "Agent ignored the concern" },
      { criterion: "No empathy shown", reason: "Responded dismissively" }
    ]
  }

MULTI-LABEL TURN BREAKDOWN:
When you return 2 node IDs, you MUST also return a turnBreakdown array that specifies which turns belong to which node. Each entry maps a node ID to its turn indices within the segment.

Example: Segment covers turns 19-21. Turns 19-20 are "Scheduling Process" (node 3), turn 21 straddles both node 3 and node 5.
  nodeIds: ["3", "5"]
  turnBreakdown: [
    { "nodeId": "3", "turns": [19, 20, 21] },
    { "nodeId": "5", "turns": [21] }
  ]

A turn can appear under multiple nodes if it genuinely serves both. But do NOT assign a turn to a node unless the turn's content actually fulfills that node's criteria.

For single-node classifications, turnBreakdown should contain one entry covering all turns in the segment.`;

// ─── Structured Output Schema ────────────────────────────────────

/**
 * JSON Schema for the classification response.
 *
 * For on-workflow segments: nodeIds, confidence, quality, qualityCriteria
 * For off_workflow segments: nodeIds=["off_workflow"], confidence, recovery, recoveryCriteria
 */
const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    nodeIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Workflow node ID(s) this segment maps to, or ["off_workflow"]',
    },
    turnBreakdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The workflow node ID' },
          turns: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Turn indices that belong to this node',
          },
        },
        required: ['nodeId', 'turns'],
        additionalProperties: false,
      },
      description: 'Per-node turn attribution. Required for multi-label segments, optional for single-node.',
    },
    confidence: {
      type: 'number',
      description: 'Confidence in the classification (0.0 to 1.0)',
    },
    quality: {
      type: ['string', 'null'],
      enum: ['full', 'partial', 'none', null],
      description: 'Quality rating for on-workflow nodes (null for off_workflow)',
    },
    qualityCriteria: {
      type: ['object', 'null'],
      properties: {
        met: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['criterion', 'evidence'],
            additionalProperties: false,
          },
        },
        not_met: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['criterion', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['met', 'not_met'],
      additionalProperties: false,
      description: 'Criteria breakdown for quality (null for off_workflow)',
    },
    recovery: {
      type: ['string', 'null'],
      enum: ['graceful', 'adequate', 'poor', null],
      description: 'Recovery rating for off_workflow segments (null for on-workflow)',
    },
    recoveryCriteria: {
      type: ['object', 'null'],
      properties: {
        met: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['criterion', 'evidence'],
            additionalProperties: false,
          },
        },
        not_met: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['criterion', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['met', 'not_met'],
      additionalProperties: false,
      description: 'Criteria breakdown for recovery (null for on-workflow)',
    },
    needsReview: {
      type: 'boolean',
      description: 'True if confidence is below threshold',
    },
    justification: {
      type: 'string',
      description: 'Brief explanation of the classification and rating decision',
    },
  },
  required: [
    'nodeIds', 'turnBreakdown', 'confidence', 'quality', 'qualityCriteria',
    'recovery', 'recoveryCriteria', 'needsReview', 'justification',
  ],
  additionalProperties: false,
};

// ─── User Prompt Builder ─────────────────────────────────────────

/**
 * Formats workflow nodes into a readable list for the LLM.
 * Includes node ID, type, label, and description so the LLM
 * can match segments by intent and assess type-aware quality.
 *
 * @param {Object[]} nodes - Workflow graph nodes
 * @returns {string} Formatted node descriptions
 */
function formatWorkflowNodes(nodes) {
  return nodes
    .map((node) => {
      const label = node.data?.label || node.label || node.id;
      const description = node.data?.description || node.description || '';
      let line = `Node ${node.id} [${node.type}] "${label}": ${description}`;

      const criteria = node.data?.criteria;
      if (criteria && Array.isArray(criteria) && criteria.length > 0) {
        line += `\n  Criteria to check:`;
        criteria.forEach((c, i) => {
          line += `\n    ${i + 1}. ${c}`;
        });
      }

      return line;
    })
    .join('\n');
}

/**
 * Formats a segment's turns into readable text for the LLM.
 *
 * @param {Object[]} transcript - Full transcript array
 * @param {number}   start      - Start turn index (inclusive)
 * @param {number}   end        - End turn index (inclusive)
 * @returns {string} Formatted turns
 */
function formatSegmentTurns(transcript, start, end) {
  return transcript
    .slice(start, end + 1)
    .map((turn, i) => `[Turn ${start + i}] ${turn.role}: ${turn.content}`)
    .join('\n');
}

/**
 * Builds the user prompt for a single segment classification call.
 *
 * Includes context windowing: the previous segment's summary helps
 * the LLM understand context that spans segment boundaries.
 * (e.g., "General checkup" only maps to Appointment Type Determination
 * because of preceding turns.)
 *
 * @param {Object}   segment         - Current segment { startTurnIndex, endTurnIndex, summary }
 * @param {string}   prevSummary     - Previous segment's summary (or "None" for first segment)
 * @param {Object[]} transcript      - Full transcript array
 * @param {Object[]} workflowNodes   - Workflow graph nodes
 * @returns {string} Complete user prompt for this classification call
 */
function buildClassificationPrompt(segment, prevSummary, transcript, workflowNodes) {
  const nodesText = formatWorkflowNodes(workflowNodes);
  const turnsText = formatSegmentTurns(transcript, segment.startTurnIndex, segment.endTurnIndex);

  return `WORKFLOW NODES:
${nodesText}

Previous segment context: ${prevSummary}

Current segment (turns ${segment.startTurnIndex} to ${segment.endTurnIndex}):
${turnsText}`;
}

module.exports = {
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_SCHEMA,
  buildClassificationPrompt,
  formatWorkflowNodes,
  formatSegmentTurns,
};