import React, { useState, useEffect } from 'react';

/**
 * WorkflowGraph — horizontal, interactive, animated workflow visualization.
 *
 * - Nodes flow left → right, branching stacked vertically
 * - Visited path edges are bold green with animated flow dots
 * - Nodes and edges fade in sequentially on mount
 * - Click a node to expand its detail panel
 */

const STATUS_STYLES = {
  visited: {
    fill: '#f0fdf4', stroke: '#22c55e', text: '#15803d',
    hoverFill: '#dcfce7',
  },
  skipped: {
    fill: '#fef2f2', stroke: '#ef4444', text: '#b91c1c',
    hoverFill: '#fee2e2',
  },
  not_needed: {
    fill: '#f9fafb', stroke: '#d1d5db', text: '#6b7280',
    hoverFill: '#f3f4f6',
  },
};

const QUALITY_STYLES = {
  full: { fill: '#dcfce7', text: '#166534' },
  partial: { fill: '#fef9c3', text: '#854d0e' },
  none: { fill: '#fef2f2', text: '#991b1b' },
};

const NODE_W = 190;
const NODE_H = 72;
const H_SPACING = 100;
const V_SPACING = 40;
const PAD = 40;

// ─── Layout ──────────────────────────────────────────────────────

function computeLayout(graph) {
  const adj = {};
  for (const node of graph.nodes) adj[node.id] = [];
  for (const edge of graph.edges) adj[edge.source].push(edge.target);

  const startNode = graph.nodes.find((n) => n.type === 'start');
  const startId = startNode ? startNode.id : graph.nodes[0].id;
  const dist = {};
  const queue = [startId];
  dist[startId] = 0;

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const next of adj[curr] || []) {
      if (dist[next] === undefined) {
        dist[next] = dist[curr] + 1;
        queue.push(next);
      }
    }
  }

  const maxDist = Math.max(...Object.values(dist), 0);
  for (const node of graph.nodes) {
    if (dist[node.id] === undefined) dist[node.id] = maxDist + 1;
  }

  const layers = {};
  for (const node of graph.nodes) {
    const layer = dist[node.id];
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(node.id);
  }

  const positions = {};
  const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
  const maxLayerSize = Math.max(...layerKeys.map((k) => layers[k].length));
  const totalMaxHeight = maxLayerSize * NODE_H + (maxLayerSize - 1) * V_SPACING;

  for (const layerIdx of layerKeys) {
    const nodesInLayer = layers[layerIdx];
    const layerHeight = nodesInLayer.length * NODE_H + (nodesInLayer.length - 1) * V_SPACING;
    const startY = PAD + (totalMaxHeight - layerHeight) / 2;

    for (let i = 0; i < nodesInLayer.length; i++) {
      positions[nodesInLayer[i]] = {
        x: PAD + layerIdx * (NODE_W + H_SPACING),
        y: startY + i * (NODE_H + V_SPACING),
      };
    }
  }

  return { positions, dist };
}

// ─── Edge Rendering ──────────────────────────────────────────────

function edgePath(sp, tp) {
  const sameLayer = Math.abs(sp.x - tp.x) < NODE_W / 2;

  if (sameLayer) {
    const sx = sp.x + NODE_W / 2;
    const sy = sp.y + NODE_H;
    const tx = tp.x + NODE_W / 2;
    const ty = tp.y;
    const bulgeX = sx + 50;
    return `M ${sx} ${sy} C ${bulgeX} ${sy + 15}, ${bulgeX} ${ty - 15}, ${tx} ${ty}`;
  }

  const sx = sp.x + NODE_W;
  const sy = sp.y + NODE_H / 2;
  const tx = tp.x;
  const ty = tp.y + NODE_H / 2;
  const cpOffset = Math.min((tx - sx) * 0.4, 60);
  return `M ${sx} ${sy} C ${sx + cpOffset} ${sy}, ${tx - cpOffset} ${ty}, ${tx} ${ty}`;
}

/**
 * Checks if an edge was actually traversed by the agent.
 * An edge source→target is highlighted only if there's a consecutive
 * transition from source to target in the visit sequence (skipping off-script).
 * Multi-label segments count as transitions between their nodes.
 */
function isEdgeOnPath(source, target, visitSequence, visitedSet) {
  if (!visitedSet.has(source) || !visitedSet.has(target)) return false;
  if (!visitSequence || visitSequence.length === 0) return false;

  // Check for consecutive transitions in the visit sequence
  // Filter to on-workflow entries only
  const onWorkflow = visitSequence.filter((e) => e.type !== 'off_script');

  for (let i = 0; i < onWorkflow.length; i++) {
    const curr = onWorkflow[i];
    const currIds = curr.nodeIds || (curr.nodeId ? [curr.nodeId] : []);

    // Check multi-label: if a single entry contains both source and target
    if (currIds.includes(source) && currIds.includes(target)) return true;

    // Check consecutive entries
    if (i < onWorkflow.length - 1) {
      const next = onWorkflow[i + 1];
      const nextIds = next.nodeIds || (next.nodeId ? [next.nodeId] : []);
      if (currIds.includes(source) && nextIds.includes(target)) return true;
    }
  }

  return false;
}

// ─── Detail Panel ────────────────────────────────────────────────

function NodeDetailPanel({ node, graphNode, onClose }) {
  if (!node) return null;

  return (
    <div
      className="mt-5 border border-gray-200 rounded-xl overflow-hidden shadow-sm"
      style={{ animation: 'slideDown 0.25s ease-out' }}
    >
      <div className="bg-gray-50 px-5 py-3 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-lg font-semibold text-gray-900">{node.label}</span>
          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{node.type}</span>
          {node.quality && (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              node.quality === 'full' ? 'bg-green-100 text-green-700' :
              node.quality === 'partial' ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>{node.quality}</span>
          )}
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            node.status === 'visited' ? 'bg-green-100 text-green-700' :
            node.status === 'skipped' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-500'
          }`}>{node.status.replace('_', ' ')}</span>
          {node.needsReview && (
            <span className="bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">needs review</span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-200 transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="px-5 py-4 bg-white">
        {/* What the graph expected */}
        {graphNode?.data?.description && (
          <div className="bg-blue-50 border border-blue-100 rounded-md px-3 py-2 mb-3">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1">Expected Behavior</p>
            <p className="text-gray-700 text-sm">{graphNode.data.description}</p>
          </div>
        )}

        {node.qualityExplanation && (
          <p className="text-sm text-gray-600 mb-4">{node.qualityExplanation}</p>
        )}

        {node.qualityCriteria && (node.qualityCriteria.met.length > 0 || node.qualityCriteria.not_met.length > 0) && (
          <div className="grid grid-cols-2 gap-6 mb-4">
            {node.qualityCriteria.met.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-2">Criteria Met</h4>
                <div className="space-y-2">
                  {node.qualityCriteria.met.map((c, i) => (
                    <div key={i} className="flex gap-2 text-sm" style={{ animation: `fadeInLeft ${0.15 + i * 0.06}s ease-out both` }}>
                      <span className="text-green-500 mt-0.5 flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#dcfce7"/><path d="M4 7l2 2 4-4" stroke="#22c55e" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <div><span className="font-medium text-gray-800">{c.criterion}</span><span className="text-gray-500"> — {c.evidence}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {node.qualityCriteria.not_met.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">Criteria Not Met</h4>
                <div className="space-y-2">
                  {node.qualityCriteria.not_met.map((c, i) => (
                    <div key={i} className="flex gap-2 text-sm" style={{ animation: `fadeInLeft ${0.15 + i * 0.06}s ease-out both` }}>
                      <span className="text-red-500 mt-0.5 flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#fef2f2"/><path d="M5 5l4 4M9 5l-4 4" stroke="#ef4444" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                      </span>
                      <div><span className="font-medium text-gray-800">{c.criterion}</span><span className="text-gray-500"> — {c.reason}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-5 text-xs text-gray-500 pt-3 border-t border-gray-100">
          {node.turns && node.turns.length > 0 && <span>Turns {node.turns[0]}–{node.turns[node.turns.length - 1]}</span>}
          {node.confidence != null && <span>Confidence {(node.confidence * 100).toFixed(0)}%</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export default function WorkflowGraph({ graph, nodeResults, offWorkflowSegments, visitedPath = [], visitSequence = [] }) {
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [visibleNodes, setVisibleNodes] = useState(new Set());
  const [visibleEdges, setVisibleEdges] = useState(new Set());

  const resultMap = {};
  const visitedSet = new Set();
  for (const nr of nodeResults) {
    resultMap[nr.nodeId] = nr;
    if (nr.status === 'visited') visitedSet.add(nr.nodeId);
  }

  const { positions, dist } = computeLayout(graph);

  // Staggered reveal: nodes appear layer by layer, edges follow
  useEffect(() => {
    const maxLayer = Math.max(...Object.values(dist), 0);

    for (let layer = 0; layer <= maxLayer; layer++) {
      // Reveal nodes in this layer
      setTimeout(() => {
        setVisibleNodes((prev) => {
          const next = new Set(prev);
          for (const node of graph.nodes) {
            if (dist[node.id] === layer) next.add(node.id);
          }
          return next;
        });
      }, layer * 200);

      // Reveal edges FROM this layer slightly after the nodes
      setTimeout(() => {
        setVisibleEdges((prev) => {
          const next = new Set(prev);
          for (const edge of graph.edges) {
            if (dist[edge.source] === layer) next.add(edge.id || `${edge.source}-${edge.target}`);
          }
          return next;
        });
      }, layer * 200 + 120);
    }
  }, []);

  const allPos = Object.values(positions);
  const svgW = Math.max(...allPos.map((p) => p.x)) + NODE_W + PAD * 2;
  const svgH = Math.max(...allPos.map((p) => p.y)) + NODE_H + PAD * 2;

  const selectedNode = selectedId ? resultMap[selectedId] : null;

  return (
    <div>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ minHeight: 200 }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
          </marker>
          <marker id="arrowGreen" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#22c55e" />
          </marker>
          <filter id="shadow">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.08" />
          </filter>
          <filter id="selectedShadow">
            <feDropShadow dx="0" dy="2" stdDeviation="6" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* Edges */}
        {graph.edges.map((edge) => {
          const sp = positions[edge.source];
          const tp = positions[edge.target];
          if (!sp || !tp) return null;

          const edgeKey = edge.id || `${edge.source}-${edge.target}`;
          const onPath = isEdgeOnPath(edge.source, edge.target, visitSequence, visitedSet);
          const d = edgePath(sp, tp);
          const isVisible = visibleEdges.has(edgeKey);

          return (
            <g key={edgeKey} style={{ opacity: isVisible ? 1 : 0, transition: 'opacity 0.4s ease-out' }}>
              <path
                d={d}
                fill="none"
                stroke={onPath ? '#22c55e' : '#cbd5e1'}
                strokeWidth={onPath ? 3 : 1.5}
                markerEnd={onPath ? 'url(#arrowGreen)' : 'url(#arrow)'}
                opacity={onPath ? 1 : 0.6}
              />

              {/* Animated flow dot on visited path edges */}
              {onPath && isVisible && (
                <circle r="4" fill="#22c55e" opacity="0.7">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path={d} />
                </circle>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;

          const nr = resultMap[node.id];
          const status = nr?.status || 'not_needed';
          const style = STATUS_STYLES[status];
          const quality = nr?.quality;
          const label = node.data?.label || node.id;
          const isSelected = selectedId === node.id;
          const isHovered = hoveredId === node.id;
          const isVisible = visibleNodes.has(node.id);

          return (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              className="cursor-pointer"
              onClick={() => setSelectedId(isSelected ? null : node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              filter={isSelected ? 'url(#selectedShadow)' : 'url(#shadow)'}
              style={{ opacity: isVisible ? 1 : 0, transition: 'opacity 0.4s ease-out' }}
            >
              {/* Card */}
              <rect
                width={NODE_W} height={NODE_H} rx="12"
                fill={isHovered ? style.hoverFill : style.fill}
                stroke={style.stroke}
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                style={{ transition: 'fill 0.15s, stroke-width 0.15s' }}
              />

              {/* Left accent bar */}
              <rect x="0" y="12" width="5" height={NODE_H - 24} rx="2" fill={style.stroke} />

              {/* Label */}
              <text x="18" y="26" fill={style.text} fontSize="13" fontWeight="600">
                {label.length > 22 ? label.slice(0, 20) + '…' : label}
              </text>

              {/* Type · Status */}
              <text x="18" y="44" fill="#94a3b8" fontSize="10">
                {node.type} · {status.replace('_', ' ')}
              </text>

              {/* Quality pill */}
              {quality && (
                <g transform={`translate(16, ${NODE_H - 22})`}>
                  <rect width="42" height="16" rx="8" fill={QUALITY_STYLES[quality].fill} />
                  <text x="21" y="11.5" textAnchor="middle" fill={QUALITY_STYLES[quality].text} fontSize="9" fontWeight="600">
                    {quality}
                  </text>
                </g>
              )}

              {/* Visit count badge (top right, shown when looped) */}
              {nr?.visitCount > 1 ? (
                <g transform={`translate(${NODE_W - 14}, 4)`}>
                  <rect width="28" height="16" rx="8" fill="#dbeafe" stroke="#93c5fd" strokeWidth="1" />
                  <text x="14" y="11.5" textAnchor="middle" fill="#1d4ed8" fontSize="9" fontWeight="600">
                    {nr.visitCount}x
                  </text>
                </g>
              ) : nr?.confidence != null ? (
                <text x={NODE_W - 12} y="16" textAnchor="end" fill="#94a3b8" fontSize="9">
                  {(nr.confidence * 100).toFixed(0)}%
                </text>
              ) : null}

              {/* Selection ring */}
              {isSelected && (
                <rect
                  x="-3" y="-3" width={NODE_W + 6} height={NODE_H + 6} rx="14"
                  fill="none" stroke={style.stroke} strokeWidth="2" opacity="0.4"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600">
        <span className="text-gray-500 font-semibold">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-emerald-500 bg-green-50"></span>
          Completed step
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-red-500 bg-red-50"></span>
          Skipped step
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-gray-300 bg-gray-50"></span>
          Not needed (different branch)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-1 bg-emerald-500 rounded"></span>
          Agent's actual path
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold text-blue-700 bg-blue-100 px-1 rounded">3x</span>
          Visited multiple times (loop)
        </span>
      </div>

      {/* Detail panel */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          graphNode={selectedId ? graph.nodes.find((n) => n.id === selectedId) : null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
