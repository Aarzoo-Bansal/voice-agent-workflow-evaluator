import React, { useState } from 'react';

/**
 * TranscriptView — annotated conversation transcript grouped by segments.
 *
 * Each turn gets a colored left border indicating which workflow node
 * it was mapped to. Off-workflow turns are purple. Latency gaps between
 * user→assistant turns are shown inline, with violations highlighted red.
 *
 * When segments are available, turns are grouped under collapsible
 * segment headers showing the segment summary from Pass 1.
 */

const NODE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
];

/**
 * Builds a mapping from turn index → { nodeId, labels[], colors[], isOffWorkflow }.
 * Supports multi-label turns where a single turn belongs to multiple nodes.
 */
function buildTurnMapping(nodeResults, offWorkflowSegments) {
  const turnMap = {};

  // Assign colors to workflow nodes
  const nodeColorMap = {};
  let colorIdx = 0;
  for (const nr of nodeResults) {
    if (nr.status === 'visited') {
      nodeColorMap[nr.nodeId] = NODE_COLORS[colorIdx % NODE_COLORS.length];
      colorIdx++;
      for (const turn of nr.turns) {
        if (!turnMap[turn]) {
          turnMap[turn] = { labels: [], colors: [], isOffWorkflow: false };
        }
        // Avoid duplicates (same node claiming the turn twice)
        if (!turnMap[turn].labels.includes(nr.label)) {
          turnMap[turn].labels.push(nr.label);
          turnMap[turn].colors.push(nodeColorMap[nr.nodeId]);
        }
      }
    }
  }

  // Mark off-workflow turns
  for (const seg of offWorkflowSegments) {
    for (const turn of seg.turns) {
      turnMap[turn] = {
        labels: [`Off-workflow (${seg.recovery})`],
        colors: ['#a855f7'],
        isOffWorkflow: true,
      };
    }
  }

  return turnMap;
}

/**
 * Computes latency between consecutive user→assistant turns.
 */
function computeLatencyGaps(transcript) {
  const gaps = {};
  for (let i = 1; i < transcript.length; i++) {
    if (transcript[i].role === 'assistant' && transcript[i - 1].role === 'user') {
      gaps[i] = (transcript[i].beginning - transcript[i - 1].end).toFixed(1);
    }
  }
  return gaps;
}

/**
 * Renders a single turn row.
 */
function TurnRow({ turn, index, mapping, gap }) {
  const primaryColor = mapping?.colors?.[0] || '#e5e7eb';
  const isViolation = gap && parseFloat(gap) > 10;

  return (
    <>
      {/* Latency gap indicator */}
      {gap && (
        <div className={`flex items-center gap-2 text-xs ml-4 py-0.5 ${isViolation ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
          <span className="flex-1 border-t border-dashed" style={{ borderColor: isViolation ? '#ef4444' : '#d1d5db' }} />
          <span>{gap}s{isViolation ? ' ⚠' : ''}</span>
          <span className="flex-1 border-t border-dashed" style={{ borderColor: isViolation ? '#ef4444' : '#d1d5db' }} />
        </div>
      )}

      {/* Turn */}
      <div
        className="flex gap-3 rounded-lg py-2 px-3 hover:bg-gray-50 transition-colors"
        style={{ borderLeft: `4px solid ${primaryColor}` }}
      >
        {/* Turn index */}
        <span className="text-xs text-gray-400 w-6 flex-shrink-0 pt-1 text-right">{index}</span>

        {/* Role badge */}
        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 h-fit mt-0.5 ${
          turn.role === 'user'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-gray-100 text-gray-700'
        }`}>
          {turn.role}
        </span>

        {/* Content */}
        <div className="flex-1">
          <p className="text-sm text-gray-800">{turn.content}</p>
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
            <span>{turn.beginning.toFixed(1)}s – {turn.end.toFixed(1)}s</span>
            {mapping && mapping.labels.map((label, i) => (
              <span
                key={i}
                className="px-1.5 py-0 rounded"
                style={{ backgroundColor: mapping.colors[i] + '20', color: mapping.colors[i] }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * A collapsible segment group with a header.
 */
function SegmentGroup({ segment, turns, turnMap, latencyGaps, startIndex }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-2">
      {/* Segment header */}
      <div
        className="flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-xs font-bold text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
          Seg {segment.segmentId}
        </span>
        <span className="text-xs text-gray-600 flex-1">{segment.summary}</span>
        <span className="text-[10px] text-gray-400">
          turns {segment.startTurnIndex}–{segment.endTurnIndex}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 14 14"
          className={`text-gray-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
        >
          <path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Turns within this segment */}
      {!collapsed && (
        <div className="ml-2 mt-1 space-y-0.5">
          {turns.map((turn, i) => {
            const turnIndex = startIndex + i;
            return (
              <TurnRow
                key={turnIndex}
                turn={turn}
                index={turnIndex}
                mapping={turnMap[turnIndex]}
                gap={latencyGaps[turnIndex]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TranscriptView({ transcript, nodeResults, offWorkflowSegments, segments }) {
  const turnMap = buildTurnMapping(nodeResults, offWorkflowSegments);
  const latencyGaps = computeLatencyGaps(transcript);
  const hasSegments = segments && segments.length > 0;

  // If segments are available, group turns by segment
  if (hasSegments) {
    return (
      <div className="space-y-1">
        {segments.map((segment) => {
          const turns = transcript.slice(segment.startTurnIndex, segment.endTurnIndex + 1);
          return (
            <SegmentGroup
              key={segment.segmentId}
              segment={segment}
              turns={turns}
              turnMap={turnMap}
              latencyGaps={latencyGaps}
              startIndex={segment.startTurnIndex}
            />
          );
        })}
      </div>
    );
  }

  // Fallback: flat list (no segments available — e.g., older result files)
  return (
    <div className="space-y-1">
      {transcript.map((turn, i) => (
        <TurnRow
          key={i}
          turn={turn}
          index={i}
          mapping={turnMap[i]}
          gap={latencyGaps[i]}
        />
      ))}
    </div>
  );
}
