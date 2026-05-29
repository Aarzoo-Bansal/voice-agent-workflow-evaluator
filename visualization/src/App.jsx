import React, { useState } from 'react';
import ScoreDashboard from './components/ScoreDashboard';
import WorkflowGraph from './components/WorkflowGraph';
import TranscriptView from './components/TranscriptView';
import EvaluationInput from './components/EvaluationInput';

import staticResult from '../../output/example-result.json';
import staticGraph from '../../data/test-graph1/graph.json';
import staticTranscript from '../../data/test-graph1/transcript-01-missed-node.json';

export default function App() {
  const [mode, setMode] = useState('example');
  const [activeTab, setActiveTab] = useState('scores');
  const [evalResult, setEvalResult] = useState(null);
  const [evalGraph, setEvalGraph] = useState(null);
  const [evalTranscript, setEvalTranscript] = useState(null);

  const hasEvalResult = evalResult && evalGraph && evalTranscript;
  const showingEval = mode === 'evaluate' && hasEvalResult;

  const result = showingEval ? evalResult : staticResult;
  const graph = showingEval ? evalGraph : staticGraph;
  const transcript = showingEval ? evalTranscript : staticTranscript;

  function handleEvalResult({ result: r, graph: g, transcript: t }) {
    setEvalResult(r);
    setEvalGraph(g);
    setEvalTranscript(t);
    setActiveTab('scores');
  }

  const showResults = mode === 'example' || hasEvalResult;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200/80 sticky top-0 z-50 glass">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Logo mark */}
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 9l4 4 8-8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h1 className="text-base font-semibold text-gray-900 tracking-tight">Workflow Verifier</h1>
                <p className="text-xs text-gray-500">
                  {mode === 'evaluate' && !hasEvalResult
                    ? 'Paste a workflow and transcript to evaluate an agent'
                    : `Evaluating a ${graph.nodes.length}-step workflow across ${transcript.length} conversation turns`
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              {/* Mode toggle */}
              <div className="flex bg-gray-100 rounded-full p-0.5">
                {['example', 'evaluate'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                      mode === m
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'example' ? 'Example' : 'Evaluate'}
                  </button>
                ))}
              </div>

              {/* Inline scores */}
              {showResults && (
                <div className="flex items-center gap-4 pl-5 border-l border-gray-200">
                  <ScorePill label="Followed script" score={result.workflow_adherence_score} />
                  <ScorePill label="Speed & efficiency" score={result.performance_score} />
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Explainer banner */}
        {mode === 'example' && (
          <div className="bg-gradient-to-r from-brand-50 to-indigo-50 border border-indigo-100 rounded-2xl px-6 py-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">How does this work?</h2>
            <p className="text-sm text-gray-600 leading-relaxed max-w-3xl">
              This tool evaluates how well an AI agent followed a <span className="font-medium text-gray-800">prescribed conversation workflow</span> (like a call script).
              It takes a workflow graph (the steps the agent should follow) and a conversation transcript, then scores
              how completely, correctly, and efficiently the agent handled the interaction.
            </p>
            <div className="flex gap-6 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span><span className="font-medium text-gray-700">Adherence</span> — did the agent follow the right steps?</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                <span><span className="font-medium text-gray-700">Performance</span> — was it fast and efficient?</span>
              </span>
            </div>
          </div>
        )}

        {/* Evaluate: input form */}
        {mode === 'evaluate' && !hasEvalResult && (
          <Card>
            <CardHeader title="Custom Evaluation" subtitle="Paste your own workflow graph and conversation transcript to evaluate a different agent interaction" />
            <EvaluationInput onResult={handleEvalResult} />
          </Card>
        )}

        {/* Evaluate: back button */}
        {mode === 'evaluate' && hasEvalResult && (
          <button
            onClick={() => { setEvalResult(null); setEvalGraph(null); setEvalTranscript(null); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 2.5L4 7l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            New Evaluation
          </button>
        )}

        {/* Results */}
        {showResults && (
          <>
            {/* Hero: Workflow Graph */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <CardHeader title="Agent's Path Through the Workflow" />
                <PathBreadcrumb result={result} />
              </div>
              <WorkflowGraph
                graph={graph}
                nodeResults={result.node_results}
                offWorkflowSegments={result.off_workflow_segments}
                visitedPath={result.visited_path}
                visitSequence={result.visit_sequence}
              />
            </Card>

            {/* Tab bar */}
            <div className="flex gap-1">
              {[
                { id: 'scores', label: 'Score Breakdown', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
                { id: 'transcript', label: 'Annotated Transcript', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-gray-900 text-white shadow-md'
                      : 'bg-white text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={tab.icon}/></svg>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'scores' && (
              <Card><ScoreDashboard result={result} graph={graph} /></Card>
            )}
            {activeTab === 'transcript' && (
              <Card>
                <CardHeader title="Annotated Transcript" subtitle="The full conversation, color-coded to show which workflow step each message belongs to" />
                <TranscriptView
                  transcript={transcript}
                  nodeResults={result.node_results}
                  offWorkflowSegments={result.off_workflow_segments}
                  segments={result.segments}
                />
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ── Shared UI Primitives ─────────────────────────────────────── */

function Card({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6">
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle }) {
  return (
    <div className="mb-1">
      <h2 className="text-sm font-semibold text-gray-900 tracking-tight">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ScorePill({ label, score }) {
  const color =
    score >= 80 ? 'text-emerald-600 bg-emerald-50 ring-emerald-200' :
    score >= 60 ? 'text-amber-600 bg-amber-50 ring-amber-200' :
    'text-red-600 bg-red-50 ring-red-200';

  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full ring-1 ${color}`}>
      <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      <span className="text-sm font-bold">{score}</span>
    </div>
  );
}

function PathBreadcrumb({ result }) {
  // Use visit_sequence if available (preserves loops), otherwise fall back to reconstructing from data
  let items;

  if (result.visit_sequence) {
    items = result.visit_sequence;
  } else {
    // Fallback: reconstruct from node_results + off_workflow_segments sorted by first turn
    items = [];
    for (const nodeId of result.visited_path) {
      const node = result.node_results.find((n) => n.nodeId === nodeId);
      if (node && node.turns && node.turns.length > 0) {
        items.push({ type: 'node', label: node.label || nodeId, turns: node.turns });
      }
    }
    for (const seg of result.off_workflow_segments) {
      if (seg.turns && seg.turns.length > 0) {
        items.push({ type: 'off_script', label: 'Off-script', turns: seg.turns, recovery: seg.recovery });
      }
    }
    items.sort((a, b) => a.turns[0] - b.turns[0]);
  }

  return (
    <div className="flex items-center gap-1.5 text-xs flex-wrap justify-end">
      <span className="text-gray-600 font-semibold mr-0.5">What actually happened:</span>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.type === 'node' ? (
            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium ring-1 ring-emerald-200"
              title={`Turns ${item.turns[0]}–${item.turns[item.turns.length - 1]}`}>
              {item.label}
            </span>
          ) : (
            <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full font-medium ring-1 ring-purple-200"
              title={`Recovery: ${item.recovery || 'n/a'}`}>
              {item.label}
            </span>
          )}
          {i < items.length - 1 && (
            <svg width="12" height="12" viewBox="0 0 12 12" className="text-gray-400 flex-shrink-0"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
