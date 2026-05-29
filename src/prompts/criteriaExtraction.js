/**
 * Criteria Extraction Prompt
 *
 * Extracts explicit, testable criteria from each workflow node's description.
 * This runs BEFORE the pipeline as a human-reviewable step so that Pass 2
 * (classification) checks against fixed criteria instead of re-interpreting
 * descriptions on the fly.
 *
 * One LLM call per node, parallelized via Promise.all.
 */

// ─── System Prompt ───────────────────────────────────────────────

const CRITERIA_EXTRACTION_SYSTEM_PROMPT = `You are a workflow compliance analyst. Given a workflow node's label, type, and description, extract every distinct, testable criterion that an agent must fulfill to fully complete this node.

Rules:
- Each criterion must be a single, atomic action, question, or requirement.
- Do NOT combine multiple requirements into one criterion. "Ask for name and DOB" is 2 criteria, not 1.
- Criteria should be verifiable from a conversation transcript — phrased as what the agent should DO or SAY.
- For START nodes: look for greeting, self-identification, opening question.
- For DECISION nodes: look for each piece of information to gather.
- For PROCESS nodes: look for each action to perform, each question to ask, each item to collect.
- For END nodes: look for summary, confirmation, follow-up offer, closing statement.
- Include criteria implied by quoted scripts (e.g., a closing script like "Thank you for calling..." implies a "use closing script" criterion).
- Order criteria in the logical sequence they would naturally occur in the conversation.
- Return between 1 and 10 criteria per node. If the description is very brief, extract at least 1.

CONDITIONAL CRITERIA:
- If the description contains conditional logic (e.g., "if Y: do Z", "when Y: do Z"), criteria that ONLY apply under a specific condition MUST include the condition in parentheses at the end.
- Format: "Do X (only if Y)" or "Do X (if Y)"
- IMPORTANT: If the description lists different conditions (e.g., "For X: do A, B, C. For Y: do A, B."), keep each condition's criteria separate — do NOT merge them.
  - Even if the action looks similar (e.g., "ask for name"), the context and purpose may differ between conditions.
  - Example: Description says "For new patients: ask for full name, DOB, contact. For returning patients: full name and DOB to access record."
    → "Ask for full name (if new patient)"
    → "Ask for date of birth (if new patient)"
    → "Ask for contact number (if new patient)"
    → "Ask for full name and DOB to access record (if returning patient)"
  - Each conditional group stays intact with its own criteria. Do NOT merge across conditions.
- Examples of truly conditional criteria:
  - "If no suitable times: offer different provider" → "Offer different provider (if no suitable times available)"
  - "Technical difficulties: say 'Bear with me'" → "Say 'I'm experiencing a brief delay. Bear with me.' (if technical difficulties)"
- Criteria that always apply should be plain text with no parentheses.
- This is critical — downstream scoring uses the "(only if ...)" format to skip criteria whose conditions don't apply to a given conversation.`;

// ─── Structured Output Schema ────────────────────────────────────

const CRITERIA_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of distinct, testable criteria extracted from the node description',
    },
  },
  required: ['criteria'],
  additionalProperties: false,
};

// ─── User Prompt Builder ─────────────────────────────────────────

/**
 * Builds the user prompt for extracting criteria from a single node.
 *
 * @param {Object} node - Workflow graph node { id, type, data: { label, description } }
 * @returns {string} Formatted user prompt
 */
function buildCriteriaExtractionPrompt(node) {
  const label = node.data?.label || node.label || node.id;
  const description = node.data?.description || node.description || '';

  return `Node ID: ${node.id}
Type: ${node.type}
Label: ${label}
Description: ${description}

Extract every distinct criterion an agent must fulfill for this node.`;
}

module.exports = {
  CRITERIA_EXTRACTION_SYSTEM_PROMPT,
  CRITERIA_EXTRACTION_SCHEMA,
  buildCriteriaExtractionPrompt,
};
