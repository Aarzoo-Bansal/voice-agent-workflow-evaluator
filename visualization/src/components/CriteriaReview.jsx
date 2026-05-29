import React, { useState } from 'react';

/**
 * CriteriaReview — editable criteria review step.
 *
 * Shows extracted criteria per node so the user can add, edit, or remove
 * them before running the pipeline. The approved criteria get embedded
 * in the graph JSON and passed to Pass 2 for evaluation.
 */

const TYPE_COLORS = {
  start: 'bg-emerald-100 text-emerald-700',
  decision: 'bg-blue-100 text-blue-700',
  process: 'bg-gray-100 text-gray-700',
  end: 'bg-red-100 text-red-700',
};

export default function CriteriaReview({ graph, onApprove, onBack }) {
  // Initialize local state from graph nodes' criteria
  const [nodeCriteria, setNodeCriteria] = useState(() => {
    const initial = {};
    for (const node of graph.nodes) {
      initial[node.id] = (node.data?.criteria || []).map((c) => c);
    }
    return initial;
  });

  function updateCriterion(nodeId, index, value) {
    setNodeCriteria((prev) => {
      const updated = { ...prev };
      updated[nodeId] = [...prev[nodeId]];
      updated[nodeId][index] = value;
      return updated;
    });
  }

  function removeCriterion(nodeId, index) {
    setNodeCriteria((prev) => {
      const updated = { ...prev };
      updated[nodeId] = prev[nodeId].filter((_, i) => i !== index);
      return updated;
    });
  }

  function addCriterion(nodeId) {
    setNodeCriteria((prev) => {
      const updated = { ...prev };
      updated[nodeId] = [...prev[nodeId], ''];
      return updated;
    });
  }

  function handleApprove() {
    // Build updated graph with edited criteria
    const updatedGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          criteria: (nodeCriteria[node.id] || []).filter((c) => c.trim() !== ''),
        },
      })),
    };
    onApprove(updatedGraph);
  }

  const totalCriteria = Object.values(nodeCriteria).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Review Criteria</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {totalCriteria} criteria across {graph.nodes.length} nodes — edit, add, or remove before running evaluation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleApprove}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Approve & Run Evaluation
          </button>
        </div>
      </div>

      {/* Tip banner */}
      <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
          <circle cx="8" cy="8" r="7" stroke="#3b82f6" strokeWidth="1.5" fill="none"/>
          <path d="M8 5v4M8 11h.01" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Conditional criteria:</span> Add a condition in parentheses for criteria that only apply in certain situations, e.g., <span className="font-mono bg-blue-100 px-1 rounded text-xs">Ask for contact number (only if new patient)</span>. Criteria whose condition doesn't match the conversation will be skipped during scoring.
        </p>
      </div>

      {/* Node cards */}
      {graph.nodes.map((node) => {
        const label = node.data?.label || node.id;
        const description = node.data?.description || '';
        const criteria = nodeCriteria[node.id] || [];
        const typeColor = TYPE_COLORS[node.type] || TYPE_COLORS.process;

        return (
          <div key={node.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
            {/* Node header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor}`}>
                  {node.type}
                </span>
                <span className="text-sm font-semibold text-gray-900">{label}</span>
                <span className="text-xs text-gray-400">Node {node.id}</span>
              </div>
              {description && (
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{description}</p>
              )}
            </div>

            {/* Criteria list */}
            <div className="px-4 py-3 space-y-2">
              {criteria.length === 0 && (
                <p className="text-xs text-gray-400 italic">No criteria extracted</p>
              )}

              {criteria.map((criterion, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">{i + 1}.</span>
                  <input
                    type="text"
                    value={criterion}
                    onChange={(e) => updateCriterion(node.id, i, e.target.value)}
                    className="flex-1 text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="e.g., Ask for contact number (only if new patient)"
                  />
                  <button
                    onClick={() => removeCriterion(node.id, i)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                    title="Remove criterion"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}

              <button
                onClick={() => addCriterion(node.id)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 mt-1 px-1 py-1 rounded hover:bg-blue-50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add Criterion
              </button>
            </div>
          </div>
        );
      })}

      {/* Bottom actions (duplicated for long lists) */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleApprove}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Approve & Run Evaluation
        </button>
      </div>
    </div>
  );
}
