/**
 * API Server for Workflow Verification Engine
 *
 * Exposes the verification pipeline as a REST endpoint so the
 * frontend can submit custom graph + transcript and get live results.
 *
 * Endpoints:
 *   POST /api/evaluate  — runs the full pipeline, returns JSON result
 *   GET  /api/health    — health check
 *
 * Usage:
 *   node src/server.js
 *   Server runs on port 3001 (frontend on 3000)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { runPipeline } = require('./index');
const { extractCriteriaForGraph } = require('./engine/criteriaExtractor');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ─── Routes ──────────────────────────────────────────────────────

/**
 * Health check — verifies the server is running and API key is set.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.OPENAI_API_KEY,
  });
});

/**
 * Run the verification pipeline on user-provided data.
 *
 * Request body:
 *   { graph: { nodes: [...], edges: [...] }, transcript: [...] }
 *
 * Response:
 *   Full verification result (same format as output/example-result.json)
 */
app.post('/api/evaluate', async (req, res) => {
  const { graph, transcript } = req.body;

  // Validate inputs
  if (!graph || !graph.nodes || !graph.edges) {
    return res.status(400).json({
      error: 'Invalid graph: must have "nodes" and "edges" arrays',
    });
  }

  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({
      error: 'Invalid transcript: must be a non-empty array of turns',
    });
  }

  // Validate turn structure
  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i];
    if (!turn.role || !turn.content || turn.beginning === undefined || turn.end === undefined) {
      return res.status(400).json({
        error: `Invalid turn at index ${i}: must have "role", "content", "beginning", and "end"`,
      });
    }
  }

  try {
    // Extract criteria if the graph doesn't already have them (e.g., "Skip Review" path).
    // If the user went through "Extract & Review", criteria are already on the nodes and this is a no-op.
    const needsExtraction = graph.nodes.some(
      (n) => !n.data?.criteria || n.data.criteria.length === 0
    );
    let graphToUse = graph;
    if (needsExtraction) {
      console.log(`\nAPI: Extracting criteria for nodes without them...`);
      graphToUse = await extractCriteriaForGraph(graph);
    }

    console.log(`\nAPI: Evaluating ${graphToUse.nodes.length} nodes, ${transcript.length} turns`);
    const result = await runPipeline(graphToUse, transcript);
    res.json(result);
  } catch (err) {
    console.error('Pipeline error:', err.message);
    res.status(500).json({
      error: `Pipeline failed: ${err.message}`,
    });
  }
});

/**
 * Extract criteria from workflow node descriptions via LLM.
 *
 * Request body:
 *   { graph: { nodes: [...], edges: [...] } }
 *
 * Response:
 *   { graph: { nodes: [...with criteria...], edges: [...] } }
 */
app.post('/api/extract-criteria', async (req, res) => {
  const { graph } = req.body;

  if (!graph || !graph.nodes || !graph.edges) {
    return res.status(400).json({
      error: 'Invalid graph: must have "nodes" and "edges" arrays',
    });
  }

  try {
    console.log(`\nAPI: Extracting criteria for ${graph.nodes.length} nodes`);
    const enrichedGraph = await extractCriteriaForGraph(graph);
    res.json({ graph: enrichedGraph });
  } catch (err) {
    console.error('Criteria extraction error:', err.message);
    res.status(500).json({
      error: `Criteria extraction failed: ${err.message}`,
    });
  }
});

// ─── Start ───────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Workflow Verification API running on http://localhost:${PORT}`);
  console.log(`  POST /api/evaluate — run verification pipeline`);
  console.log(`  GET  /api/health   — health check`);
  console.log(`  API Key: ${process.env.OPENAI_API_KEY ? 'configured' : 'MISSING'}\n`);
});
