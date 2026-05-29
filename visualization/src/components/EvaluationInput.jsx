import React, { useState } from 'react';
import CriteriaReview from './CriteriaReview';

const API_URL = 'http://localhost:3001';

// Default example data to pre-populate the editors
const DEFAULT_GRAPH = `{
  "edges": [
    {"id": "e1-2", "source": "1", "target": "2"},
    {"id": "e2-3", "source": "2", "target": "3"},
    {"id": "e3-4", "source": "3", "target": "4"},
    {"id": "e3-5", "source": "3", "target": "5"},
    {"id": "e4-5", "source": "4", "target": "5"}
  ],
  "nodes": [
    {"id": "1", "data": {"label": "Introduction", "description": "Greet the caller and ask how to help."}, "type": "start", "position": {"x": 250, "y": 25}},
    {"id": "2", "data": {"label": "Appointment Type", "description": "Identify appointment type, provider preference, urgency."}, "type": "decision", "position": {"x": 250, "y": 125}},
    {"id": "3", "data": {"label": "Scheduling", "description": "Collect name, DOB, offer time slots, confirm."}, "type": "process", "position": {"x": 250, "y": 225}},
    {"id": "4", "data": {"label": "Error Handling", "description": "Handle unclear input or technical issues."}, "type": "process", "position": {"x": 250, "y": 325}},
    {"id": "5", "data": {"label": "Confirmation", "description": "Summarize, offer reminders, close."}, "type": "end", "position": {"x": 250, "y": 425}}
  ]
}`;

const DEFAULT_TRANSCRIPT = `[
  {"role": "user", "content": "Hello?", "beginning": 1.2, "end": 1.7},
  {"role": "assistant", "content": "Hi! How can I help you today?", "beginning": 2.0, "end": 4.0},
  {"role": "user", "content": "I need to book a checkup.", "beginning": 5.0, "end": 7.0},
  {"role": "assistant", "content": "Sure, a general checkup. Any provider preference?", "beginning": 8.0, "end": 11.0},
  {"role": "user", "content": "No preference, first available.", "beginning": 12.0, "end": 14.0},
  {"role": "assistant", "content": "Got it. Can I have your name and date of birth?", "beginning": 15.0, "end": 18.0},
  {"role": "user", "content": "Jane Doe, March 5th 1990.", "beginning": 19.0, "end": 21.0},
  {"role": "assistant", "content": "I have Thursday at 2pm with Dr. Smith. Does that work?", "beginning": 22.0, "end": 26.0},
  {"role": "user", "content": "That works.", "beginning": 27.0, "end": 28.0},
  {"role": "assistant", "content": "All set! Your appointment is Thursday at 2pm. Anything else?", "beginning": 29.0, "end": 33.0},
  {"role": "user", "content": "No, that's all. Thanks!", "beginning": 34.0, "end": 36.0},
  {"role": "assistant", "content": "Thank you for calling! Goodbye.", "beginning": 37.0, "end": 39.0}
]`;

/**
 * Validates a JSON string and returns { valid, data, error }.
 */
function parseJSON(str, label) {
  try {
    const data = JSON.parse(str);
    return { valid: true, data, error: null };
  } catch (e) {
    return { valid: false, data: null, error: `Invalid ${label} JSON: ${e.message}` };
  }
}

export default function EvaluationInput({ onResult }) {
  const [graphText, setGraphText] = useState(DEFAULT_GRAPH);
  const [transcriptText, setTranscriptText] = useState(DEFAULT_TRANSCRIPT);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');

  // Multi-step flow
  const [step, setStep] = useState('input'); // 'input' | 'review'
  const [graphWithCriteria, setGraphWithCriteria] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [running, setRunning] = useState(false);

  /**
   * Checks API health. Returns true if OK, false if not.
   */
  async function checkHealth() {
    try {
      const healthRes = await fetch(`${API_URL}/api/health`);
      const health = await healthRes.json();
      if (!health.hasApiKey) {
        setError('API server is running but no OpenAI API key is configured. Add it to .env');
        return false;
      }
      return true;
    } catch {
      setError('Cannot connect to API server. Run: npm run server');
      return false;
    }
  }

  /**
   * Validates graph + transcript JSON. Returns parsed data or null.
   */
  function validateInputs() {
    const graphParsed = parseJSON(graphText, 'Graph');
    if (!graphParsed.valid) { setError(graphParsed.error); return null; }

    const transcriptParsed = parseJSON(transcriptText, 'Transcript');
    if (!transcriptParsed.valid) { setError(transcriptParsed.error); return null; }

    return { graph: graphParsed.data, transcript: transcriptParsed.data };
  }

  /**
   * Step 1 → Step 2: Extract criteria from graph, show review UI.
   */
  async function handleExtractCriteria() {
    setError(null);
    setProgress('');

    const inputs = validateInputs();
    if (!inputs) return;

    setProgress('Checking API connection...');
    const healthy = await checkHealth();
    if (!healthy) { setProgress(''); return; }

    setExtracting(true);
    setProgress('Extracting criteria from node descriptions (this takes a few seconds)...');

    try {
      const res = await fetch(`${API_URL}/api/extract-criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: inputs.graph }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const { graph: enrichedGraph } = await res.json();
      setGraphWithCriteria(enrichedGraph);
      setStep('review');
      setProgress('');
    } catch (err) {
      setError(err.message);
      setProgress('');
    } finally {
      setExtracting(false);
    }
  }

  /**
   * Run the pipeline (either after review or skipping review).
   */
  async function runEvaluation(graphToUse) {
    setError(null);
    setProgress('');

    const transcriptParsed = parseJSON(transcriptText, 'Transcript');
    if (!transcriptParsed.valid) { setError(transcriptParsed.error); return; }

    setRunning(true);
    setProgress('Running pipeline (this takes 15-30 seconds)...');

    try {
      const res = await fetch(`${API_URL}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphToUse,
          transcript: transcriptParsed.data,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const result = await res.json();
      setProgress('');

      onResult({
        result,
        graph: graphToUse,
        transcript: transcriptParsed.data,
      });
    } catch (err) {
      setError(err.message);
      setProgress('');
    } finally {
      setRunning(false);
    }
  }

  /**
   * Skip review: validate, check health, run directly.
   */
  async function handleSkipReview() {
    setError(null);
    setProgress('');

    const inputs = validateInputs();
    if (!inputs) return;

    setProgress('Checking API connection...');
    const healthy = await checkHealth();
    if (!healthy) { setProgress(''); return; }

    await runEvaluation(inputs.graph);
  }

  /**
   * Callback from CriteriaReview: user approved the criteria.
   */
  async function handleCriteriaApproved(updatedGraph) {
    // Update the graph text to reflect the criteria-enriched version
    setGraphText(JSON.stringify(updatedGraph, null, 2));
    setStep('input');
    await runEvaluation(updatedGraph);
  }

  /**
   * Callback from CriteriaReview: user wants to go back.
   */
  function handleBack() {
    setStep('input');
    setGraphWithCriteria(null);
    setError(null);
    setProgress('');
  }

  const isLoading = extracting || running;

  // ─── Step 2: Criteria Review ─────────────────────────────────
  if (step === 'review' && graphWithCriteria) {
    return (
      <div className="space-y-4">
        {/* Error display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Progress display */}
        {progress && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {progress}
          </div>
        )}

        <CriteriaReview
          graph={graphWithCriteria}
          onApprove={handleCriteriaApproved}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ─── Step 1: Input Form ──────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Graph editor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Workflow Graph JSON
          </label>
          <textarea
            value={graphText}
            onChange={(e) => setGraphText(e.target.value)}
            className="w-full h-80 font-mono text-xs p-3 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            spellCheck={false}
            placeholder='{"nodes": [...], "edges": [...]}'
          />
        </div>

        {/* Transcript editor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Conversation Transcript JSON
          </label>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            className="w-full h-80 font-mono text-xs p-3 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            spellCheck={false}
            placeholder='[{"role": "user", "content": "...", "beginning": 0, "end": 1}, ...]'
          />
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Progress display */}
      {progress && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {progress}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleExtractCriteria}
          disabled={isLoading}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors ${
            isLoading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }`}
        >
          {extracting ? 'Extracting...' : 'Extract & Review Criteria'}
        </button>

        <button
          onClick={handleSkipReview}
          disabled={isLoading}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            isLoading
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 hover:border-gray-400'
          }`}
        >
          {running ? 'Evaluating...' : 'Skip Review & Run'}
        </button>

        <span className="text-xs text-gray-400">
          Requires API server running on port 3001
        </span>
      </div>
    </div>
  );
}
