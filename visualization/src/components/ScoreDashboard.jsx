import React from 'react';

/**
 * Circular gauge with gradient ring and centered score.
 */
function ScoreGauge({ label, score, subtitle }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const gradientId = `gauge-${label.replace(/\s/g, '')}`;

  const colors =
    score >= 80 ? ['#34d399', '#059669'] :
    score >= 60 ? ['#fbbf24', '#d97706'] :
    score >= 40 ? ['#fb923c', '#ea580c'] : ['#f87171', '#dc2626'];

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="120" height="120" className="transform -rotate-90">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors[0]} />
              <stop offset="100%" stopColor={colors[1]} />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="8" />
          <circle
            cx="60" cy="60" r={radius} fill="none"
            stroke={`url(#${gradientId})`} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-gray-900">{score}</span>
          <span className="text-[10px] text-gray-500 -mt-0.5">/ 100</span>
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold text-gray-700">{label}</p>
      <p className="text-[11px] text-gray-500">{subtitle}</p>
    </div>
  );
}

/**
 * Generates a human-readable explanation for each metric score
 * directly from the result data — no LLM needed.
 */
function generateMetricExplanation(metric, result) {
  const nodes = result.node_results || [];
  const visited = nodes.filter((n) => n.status === 'visited');
  const skipped = nodes.filter((n) => n.status === 'skipped');
  const notNeeded = nodes.filter((n) => n.status === 'not_needed');
  const offWorkflow = result.off_workflow_segments || [];
  const bestPath = result.best_matching_path || [];
  const visitedPath = result.visited_path || [];

  switch (metric) {
    case 'completeness': {
      const visitedFromPath = bestPath.filter((id) => visitedPath.includes(id));
      const missedFromPath = bestPath.filter((id) => !visitedPath.includes(id));
      const lastVisited = visitedPath[visitedPath.length - 1];
      const endNodes = nodes.filter((n) => n.type === 'end').map((n) => n.nodeId);
      const reachedEnd = endNodes.includes(lastVisited);
      const parts = [];

      // What it measures
      parts.push('📐 Measures: What fraction of required workflow nodes did the agent visit?');
      parts.push(`📊 Calculation: visited required nodes ÷ total required nodes${!reachedEnd ? ', then 30% penalty for not reaching an end node' : ''} (weight: 30% of adherence)`);

      // Why this score
      parts.push(`✅ ${visitedFromPath.length} of ${bestPath.length} required nodes visited`);
      if (missedFromPath.length > 0) {
        const missedLabels = missedFromPath.map((id) => nodes.find((n) => n.nodeId === id)?.label || id);
        parts.push(`❌ Skipped: ${missedLabels.join(', ')}`);
      }
      if (notNeeded.length > 0) {
        parts.push(`ℹ️ ${notNeeded.length} node(s) not required (agent took a different branch)`);
      }
      if (!reachedEnd) {
        parts.push('⚠️ Conversation did not reach an end node — 30% penalty applied');
      }
      return parts;
    }

    case 'ordering': {
      const score = result.adherence_scores.ordering;
      const parts = [];

      // What it measures
      parts.push('📐 Measures: Did the agent visit nodes in a valid sequence according to the workflow graph edges?');
      parts.push('📊 Calculation: longest valid subsequence ÷ total visited nodes, penalized if agent didn\'t start at the start node (weight: 25% of adherence)');

      // Why this score
      if (score === 1.0) {
        parts.push('✅ All transitions followed valid graph edges in correct order');
      } else {
        parts.push(`⚠️ Longest valid subsequence covers ${Math.round(score * 100)}% of visited nodes`);
        parts.push('❌ Some transitions did not follow valid graph edges');
      }
      const startNode = nodes.find((n) => n.type === 'start');
      if (startNode && visitedPath.length > 0 && visitedPath[0] !== startNode.nodeId) {
        parts.push(`⚠️ Agent didn't start at "${startNode.label}" — 20% penalty applied`);
      }
      return parts;
    }

    case 'quality': {
      const parts = [];

      // What it measures
      parts.push('📐 Measures: How thoroughly did the agent fulfill each node\'s criteria? Each node has pre-extracted criteria from its description.');
      parts.push('📊 Calculation: criteria are merged across all segments for each node — if a criterion is met anywhere, it counts. Score = met ÷ total criteria, averaged across nodes (weight: 25% of adherence)');

      // Why this score — show merged result per node
      for (const n of visited) {
        const met = n.qualityCriteria?.met || [];
        const notMet = n.qualityCriteria?.not_met || [];

        if (n.quality === 'full') {
          parts.push(`✅ ${n.label}: all ${met.length} criteria met`);
        } else if (n.quality === 'partial') {
          const missedNames = notMet.map((c) => c.criterion).join(', ');
          parts.push(`⚠️ ${n.label}: ${met.length} of ${met.length + notMet.length} criteria met — missing ${missedNames || 'some criteria'}`);
        } else if (n.quality === 'none') {
          parts.push(`❌ ${n.label}: topic touched but none of ${notMet.length} criteria fulfilled`);
        }
      }

      if (visited.length === 0) parts.push('❌ No on-workflow nodes visited');

      return parts;
    }

    case 'recovery': {
      const parts = [];

      // What it measures
      parts.push('📐 Measures: When the conversation went off-script, how well did the agent handle it and get back on track?');
      parts.push('📊 Calculation: average recovery rating across off-workflow segments (graceful=100%, adequate=50%, poor=0%) (weight: 20% of adherence)');

      if (offWorkflow.length === 0) {
        parts.push('✅ No off-workflow segments — score defaults to 100%');
        return parts;
      }

      // Why this score
      for (const seg of offWorkflow) {
        const met = seg.recoveryCriteria?.met || [];
        const notMet = seg.recoveryCriteria?.not_met || [];
        const metNames = met.map((c) => c.criterion).join(', ');
        const notMetNames = notMet.map((c) => c.criterion).join(', ');
        const icon = seg.recovery === 'graceful' ? '✅' : seg.recovery === 'adequate' ? '⚠️' : '❌';
        let line = `${icon} Segment ${seg.segmentId} (turns ${seg.turns[0]}–${seg.turns[seg.turns.length - 1]}): ${seg.recovery}`;
        if (metNames) line += ` — met: ${metNames}`;
        if (notMetNames) line += ` — not met: ${notMetNames}`;
        parts.push(line);
      }
      return parts;
    }

    case 'latency': {
      const d = result.latency_details;
      const parts = [];

      // What it measures
      parts.push('📐 Measures: How quickly did the agent respond to the user?');
      parts.push('📊 Calculation: scored by average response time — ≤5s: 100%, ≤10s: 75%, ≤15s: 50%, >15s: 25% (weight: 50% of performance)');

      // Why this score
      parts.push(`Average response time: ${d.avg_seconds}s`);
      if (d.max_seconds > 10) {
        parts.push(`⚠️ Max response time: ${d.max_seconds}s (spike)`);
      }
      if (d.violations_over_10s > 0) {
        parts.push(`⚠️ ${d.violations_over_10s} response(s) exceeded 10s threshold`);
      }
      if (d.avg_seconds <= 5) parts.push('✅ Rating: Excellent (avg ≤ 5s)');
      else if (d.avg_seconds <= 10) parts.push('✅ Rating: Good (avg ≤ 10s)');
      else if (d.avg_seconds <= 15) parts.push('⚠️ Rating: Fair (avg ≤ 15s)');
      else parts.push('❌ Rating: Poor (avg > 15s)');
      return parts;
    }

    case 'efficiency': {
      const e = result.efficiency_details;
      const parts = [];

      // What it measures
      parts.push('📐 Measures: How concisely did the agent complete the workflow? Fewer turns for the same outcome is better.');
      parts.push('📊 Calculation: scored by turns per required node — ≤4: 100%, ≤6: 75%, ≤8: 50%, >8: 25% (weight: 50% of performance)');

      // Why this score
      parts.push(`${e.total_turns} total turns ÷ ${bestPath.length} required nodes = ${e.turns_per_required_node} turns/node`);
      parts.push(`Conversation duration: ${e.duration_seconds}s`);
      if (e.turns_per_required_node <= 4) parts.push('✅ Rating: Excellent (≤ 4 turns/node)');
      else if (e.turns_per_required_node <= 6) parts.push('✅ Rating: Good (≤ 6 turns/node)');
      else if (e.turns_per_required_node <= 8) parts.push('⚠️ Rating: Fair (≤ 8 turns/node)');
      else parts.push('❌ Rating: Poor (> 8 turns/node)');
      if (offWorkflow.length > 0) {
        const offTurns = offWorkflow.reduce((sum, s) => sum + s.turns.length, 0);
        parts.push(`ℹ️ ${offTurns} turns spent on off-workflow detours (inflates turn count)`);
      }
      return parts;
    }

    default:
      return [];
  }
}

/**
 * Horizontal progress bar with expandable "why" explanation.
 */
function MetricBar({ label, description, value, weight, metricKey, result }) {
  const [expanded, setExpanded] = React.useState(false);
  const percentage = Math.round(value * 100);
  const color =
    percentage >= 80 ? 'bg-green-500' :
    percentage >= 50 ? 'bg-yellow-500' :
    percentage >= 25 ? 'bg-orange-500' : 'bg-red-500';

  const explanations = expanded ? generateMetricExplanation(metricKey, result) : [];

  return (
    <div className="mb-3">
      <div
        className="flex justify-between text-sm mb-1 cursor-pointer hover:bg-gray-50 -mx-2 px-2 py-0.5 rounded transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-gray-700">
          {label} {description && <span className="text-gray-500 text-xs font-normal">— {description}</span>}
          <span className="text-gray-300 text-xs ml-1">{expanded ? '▲' : '▼'}</span>
        </span>
        <span className="font-medium">{percentage}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${percentage}%` }} />
      </div>
      {expanded && explanations.length > 0 && (
        <div className="mt-2 ml-1 text-xs text-gray-600 space-y-1 border-l-2 border-gray-200 pl-3 mb-2">
          {explanations.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Per-node summary card showing status, quality, criteria,
 * and the original graph description (what was expected).
 */
function NodeCard({ node, graphNode }) {
  const [expanded, setExpanded] = React.useState(false);

  const accent = {
    visited: 'border-l-emerald-500',
    skipped: 'border-l-red-400',
    not_needed: 'border-l-gray-300',
  };

  const statusBadge = {
    visited: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    skipped: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    not_needed: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200',
  };

  const qualityBadge = {
    full: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    partial: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    none: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  };

  return (
    <div
      className={`border-l-4 rounded-xl bg-white border border-gray-100 p-4 mb-2 cursor-pointer hover:shadow-md transition-all duration-200 ${accent[node.status]}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-gray-900 text-sm">{node.label}</span>
          <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{node.type}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {node.quality && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${qualityBadge[node.quality]}`}>
              {node.quality}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge[node.status]}`}>
            {node.status.replace('_', ' ')}
          </span>
          {node.needsReview && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 ring-1 ring-orange-200">
              review
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 16 16" className={`text-gray-300 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 text-sm space-y-3">
          {/* Expected behavior from graph */}
          {graphNode && graphNode.data?.description && (
            <div className="bg-indigo-50/70 border border-indigo-100 rounded-lg px-3.5 py-2.5">
              <p className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider mb-1">Expected Behavior</p>
              <p className="text-gray-700 text-[13px] leading-relaxed">{graphNode.data.description}</p>
            </div>
          )}

          {/* LLM explanation */}
          {node.qualityExplanation && (
            <p className="text-gray-500 text-[13px] leading-relaxed">{node.qualityExplanation}</p>
          )}

          {/* Criteria */}
          {node.qualityCriteria && (
            <div className="grid grid-cols-2 gap-4">
              {node.qualityCriteria.met.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Criteria Met</p>
                  {node.qualityCriteria.met.map((c, i) => (
                    <div key={i} className="flex gap-2 text-[13px]">
                      <span className="text-emerald-500 mt-0.5 flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#ecfdf5"/><path d="M4 7l2 2 4-4" stroke="#059669" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className="text-gray-600"><span className="font-medium text-gray-800">{c.criterion}</span> — {c.evidence}</span>
                    </div>
                  ))}
                </div>
              )}
              {node.qualityCriteria.not_met.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">Criteria Not Met</p>
                  {node.qualityCriteria.not_met.map((c, i) => (
                    <div key={i} className="flex gap-2 text-[13px]">
                      <span className="text-red-400 mt-0.5 flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#fef2f2"/><path d="M5 5l4 4M9 5l-4 4" stroke="#dc2626" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                      </span>
                      <span className="text-gray-600"><span className="font-medium text-gray-800">{c.criterion}</span> — {c.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Visit history — only shown when node was visited multiple times */}
          {node.visits && node.visits.length > 1 && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider mb-2">
                Visit History ({node.visits.length} visits)
              </p>
              <div className="space-y-1.5">
                {node.visits.map((visit, i) => {
                  const visitBadge = {
                    full: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
                    partial: 'bg-amber-50 text-amber-700 ring-amber-200',
                    none: 'bg-red-50 text-red-700 ring-red-200',
                  };
                  const firstTurn = visit.turns[0];
                  const lastTurn = visit.turns[visit.turns.length - 1];
                  return (
                    <div key={i} className="flex items-center gap-2.5 text-[12px]">
                      <span className="text-gray-400 font-mono w-14 flex-shrink-0">
                        Visit {i + 1}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 flex-shrink-0 ${visitBadge[visit.quality] || 'bg-gray-50 text-gray-500 ring-gray-200'}`}>
                        {visit.quality || 'n/a'}
                      </span>
                      <span className="text-gray-500 text-[11px]">
                        Turns {firstTurn}{firstTurn !== lastTurn ? `–${lastTurn}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex gap-4 text-[11px] text-gray-500 pt-3 border-t border-gray-100">
            {node.turns && node.turns.length > 0 && <span>Turns {node.turns[0]}–{node.turns[node.turns.length - 1]}</span>}
            {node.confidence != null && <span>Confidence {(node.confidence * 100).toFixed(0)}%</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ScoreDashboard — top-level scoring display.
 * Two gauges, metric progress bars, per-node cards, and the qualitative summary.
 */
export default function ScoreDashboard({ result, graph }) {
  // Build a lookup from nodeId → graph node for descriptions
  const graphNodeMap = {};
  if (graph?.nodes) {
    for (const gn of graph.nodes) {
      graphNodeMap[gn.id] = gn;
    }
  }
  return (
    <div className="space-y-8">
      {/* Score Gauges */}
      <div className="flex justify-center gap-12">
        <ScoreGauge label="Workflow Adherence" score={result.workflow_adherence_score} subtitle="Did the agent follow the right steps, in order, and completely?" />
        <div className="w-px bg-gray-100 my-4" />
        <ScoreGauge label="Performance" score={result.performance_score} subtitle="Did the agent respond quickly and resolve the task without wasted turns?" />
      </div>

      {/* Needs Review Warning */}
      {result.needs_review_count > 0 && (
        <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 5v4M8 11h.01" stroke="#d97706" strokeWidth="2" strokeLinecap="round"/><circle cx="8" cy="8" r="7" stroke="#d97706" strokeWidth="1.5" fill="none"/></svg>
          </div>
          <span className="text-amber-800 text-sm">{result.needs_review_count} segment(s) flagged for manual review — low classification confidence</span>
        </div>
      )}

      {/* Metric Breakdowns */}
      <div className="grid grid-cols-2 gap-10">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Did the agent follow the script?</h3>
          <p className="text-xs text-gray-500 mb-3">Click any bar to see why it scored this way</p>
          <MetricBar label="Completeness" description="Were all required steps visited?" value={result.adherence_scores.completeness} weight={0.30} metricKey="completeness" result={result} />
          <MetricBar label="Ordering" description="Were steps done in the correct order?" value={result.adherence_scores.ordering} weight={0.25} metricKey="ordering" result={result} />
          <MetricBar label="Quality" description="Was each step handled thoroughly?" value={result.adherence_scores.quality} weight={0.25} metricKey="quality" result={result} />
          <MetricBar label="Recovery" description="Did the agent get back on track after going off-script?" value={result.adherence_scores.recovery} weight={0.20} metricKey="recovery" result={result} />
        </div>
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Was the agent fast and efficient?</h3>
          <p className="text-xs text-gray-500 mb-3">Click any bar to see why it scored this way</p>
          <MetricBar label="Response Time" description="How quickly did the agent reply?" value={result.performance_scores.latency} weight={0.50} metricKey="latency" result={result} />
          <MetricBar label="Efficiency" description="How many turns did it take to get the job done?" value={result.performance_scores.efficiency} weight={0.50} metricKey="efficiency" result={result} />
        </div>
      </div>

      {/* Per-Node Results */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Step-by-Step Results</h3>
        <p className="text-xs text-gray-500 mb-3">How the agent performed at each workflow step — click to expand</p>
        {result.node_results.map((node) => (
          <NodeCard key={node.nodeId} node={node} graphNode={graphNodeMap[node.nodeId]} />
        ))}
      </div>

      {/* Off-Workflow Segments */}
      {result.off_workflow_segments.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Off-Script Moments</h3>
          <p className="text-xs text-gray-500 mb-3">Parts of the conversation where the agent went outside the workflow (e.g., the customer asked something unexpected)</p>
          {result.off_workflow_segments.map((seg) => (
            <div key={seg.segmentId} className="border-l-4 border-l-purple-400 bg-white border border-gray-100 rounded-xl p-4 mb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm">Segment {seg.segmentId}</span>
                  <span className="text-[11px] text-gray-500">turns {seg.turns[0]}–{seg.turns[seg.turns.length - 1]}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  seg.recovery === 'graceful' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' :
                  seg.recovery === 'adequate' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' :
                  'bg-red-50 text-red-700 ring-1 ring-red-200'
                }`}>{seg.recovery}</span>
              </div>
              {seg.recoveryCriteria && (
                <div className="text-[13px] space-y-1">
                  {seg.recoveryCriteria.met.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-emerald-500 flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#ecfdf5"/><path d="M4 7l2 2 4-4" stroke="#059669" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className="text-gray-600"><span className="font-medium text-gray-800">{c.criterion}</span> — {c.evidence}</span>
                    </div>
                  ))}
                  {seg.recoveryCriteria.not_met.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-red-400 flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#fef2f2"/><path d="M5 5l4 4M9 5l-4 4" stroke="#dc2626" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                      </span>
                      <span className="text-gray-600"><span className="font-medium text-gray-800">{c.criterion}</span> — {c.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Qualitative Summary */}
      <div className="bg-gradient-to-br from-slate-50 to-gray-50 border border-gray-200/80 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Qualitative Summary</h3>
        <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-line">{result.qualitative_summary}</p>
      </div>
    </div>
  );
}
