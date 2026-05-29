/**
 * Criteria Extractor
 *
 * Extracts explicit, testable criteria from each workflow node's description
 * via an LLM call. One call per node, parallelized with Promise.all.
 *
 * Returns a new graph object with `node.data.criteria` populated —
 * does NOT mutate the input graph.
 *
 * Nodes that already have a non-empty `criteria` array are skipped
 * so that user-curated criteria are preserved on re-extraction.
 */

const { callLLMStructured } = require('../llm/client');
const { LLM_CONFIG } = require('../config');
const {
  CRITERIA_EXTRACTION_SYSTEM_PROMPT,
  CRITERIA_EXTRACTION_SCHEMA,
  buildCriteriaExtractionPrompt,
} = require('../prompts/criteriaExtraction');

/**
 * Extracts criteria for a single node.
 *
 * @param {Object} node - Workflow graph node
 * @returns {Promise<string[]>} Array of criteria strings
 */
async function extractCriteriaForNode(node) {
  const userPrompt = buildCriteriaExtractionPrompt(node);

  const response = await callLLMStructured({
    systemPrompt: CRITERIA_EXTRACTION_SYSTEM_PROMPT,
    userPrompt,
    model: LLM_CONFIG.criteriaExtractionModel,
    schemaName: 'criteria_extraction_response',
    schema: CRITERIA_EXTRACTION_SCHEMA,
  });

  return response.criteria || [];
}

/**
 * Extracts criteria for all nodes in a graph that don't already have them.
 *
 * @param {Object} graph - Workflow graph { nodes: [...], edges: [...] }
 * @returns {Promise<Object>} New graph object with criteria populated on each node
 */
async function extractCriteriaForGraph(graph) {
  // Deep copy to avoid mutating input
  const enrichedGraph = JSON.parse(JSON.stringify(graph));

  const extractionPromises = enrichedGraph.nodes.map(async (node) => {
    // Skip nodes that already have criteria
    const existing = node.data?.criteria;
    if (existing && Array.isArray(existing) && existing.length > 0) {
      return;
    }

    const criteria = await extractCriteriaForNode(node);

    // Ensure data object exists
    if (!node.data) node.data = {};
    node.data.criteria = criteria;
  });

  await Promise.all(extractionPromises);

  return enrichedGraph;
}

module.exports = {
  extractCriteriaForGraph,
  extractCriteriaForNode,
};
