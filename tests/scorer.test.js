/**
 * Tests for Scoring Engine (src/engine/scorer.js)
 *
 * Covers all 8 exported functions organized by the design doc's
 * Level 2 evaluation strategy (deterministic scorer unit tests):
 *
 *   - Perfect path → adherence ~95+
 *   - Skipped node → completeness drops
 *   - Wrong order → ordering drops
 *   - Backtracking → ordering NOT severely penalized
 *   - All partial quality → quality at 50%
 *   - Poor recovery → recovery drops
 *   - No end node → completeness penalized 30%
 *   - No start node first → ordering penalized 20%
 *   - High latency + perfect workflow → adherence high, performance low
 *   - Agent takes branch A → nodes from branch B not required
 */

const {
  computeCompleteness,
  computeOrdering,
  computeQuality,
  computeRecovery,
  computeLatency,
  computeEfficiency,
  computeAdherenceScore,
  computePerformanceScore,
} = require('../src/engine/scorer');

// ─── Shared Fixtures ─────────────────────────────────────────────

/**
 * NexaCare example graph:
 *   1 (start) → 2 (decision) → 3 (process) → 4 (process) → 5 (end)
 *                                            └→ 5 (end)
 */
const workflowGraph = {
  nodes: [
    { id: '1', type: 'start' },
    { id: '2', type: 'decision' },
    { id: '3', type: 'process' },
    { id: '4', type: 'process' },
    { id: '5', type: 'end' },
  ],
  edges: [
    { source: '1', target: '2' },
    { source: '2', target: '3' },
    { source: '3', target: '4' },
    { source: '3', target: '5' },
    { source: '4', target: '5' },
  ],
};

/**
 * Branchy graph:
 *   A (start) → B → C → D → G (end)
 *                 └→ E → F → G (end)
 */
const branchyGraph = {
  nodes: [
    { id: 'A', type: 'start' },
    { id: 'B', type: 'decision' },
    { id: 'C', type: 'process' },
    { id: 'D', type: 'process' },
    { id: 'E', type: 'process' },
    { id: 'F', type: 'process' },
    { id: 'G', type: 'end' },
  ],
  edges: [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
    { source: 'B', target: 'E' },
    { source: 'C', target: 'D' },
    { source: 'D', target: 'G' },
    { source: 'E', target: 'F' },
    { source: 'F', target: 'G' },
  ],
};

// Helper: builds an agentPath entry for an on-workflow node
function node(id, quality = 'full') {
  return { nodeIds: [id], quality, recovery: null };
}

// Helper: builds an agentPath entry for an off-workflow segment
function offWorkflow(recovery = 'graceful') {
  return { nodeIds: ['off_workflow'], quality: null, recovery };
}

// ─── computeCompleteness ─────────────────────────────────────────

describe('computeCompleteness', () => {
  test('perfect happy path → 1.0', () => {
    // Agent visited 1 → 2 → 3 → 5 (all nodes on happy path)
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    expect(computeCompleteness(agentPath, workflowGraph)).toBe(1.0);
  });

  test('perfect long path → 1.0', () => {
    // Agent visited 1 → 2 → 3 → 4 → 5 (all nodes including error handling)
    const agentPath = [node('1'), node('2'), node('3'), node('4'), node('5')];
    expect(computeCompleteness(agentPath, workflowGraph)).toBe(1.0);
  });

  test('skipped node → completeness drops below 1.0', () => {
    // Agent visited 1 → 2 → 5 (skipped node 3)
    const agentPath = [node('1'), node('2'), node('5')];
    const score = computeCompleteness(agentPath, workflowGraph);

    // Best path is [1,2,3,5] — visited 3/4 = 0.75
    expect(score).toBe(0.75);
  });

  test('no end node reached → 30% penalty applied', () => {
    // Agent visited 1 → 2 → 3 but never reached node 5
    const agentPath = [node('1'), node('2'), node('3')];
    const score = computeCompleteness(agentPath, workflowGraph);

    // Best path [1,2,3,5], visited 3/4 = 0.75, then × 0.7 = 0.525
    expect(score).toBeCloseTo(0.525);
  });

  test('off-workflow segments are filtered out before path matching', () => {
    // Agent: 1 → off_workflow → 2 → 3 → 5
    const agentPath = [node('1'), offWorkflow(), node('2'), node('3'), node('5')];
    expect(computeCompleteness(agentPath, workflowGraph)).toBe(1.0);
  });

  test('only off-workflow segments → 0', () => {
    const agentPath = [offWorkflow(), offWorkflow()];
    expect(computeCompleteness(agentPath, workflowGraph)).toBe(0);
  });

  test('branch-aware: agent takes branch A → branch B nodes not required', () => {
    // Agent took branch 2: A → B → E → F → G
    const agentPath = [node('A'), node('B'), node('E'), node('F'), node('G')];
    const score = computeCompleteness(agentPath, branchyGraph);

    // Best path = [A,B,E,F,G], all 5 visited → 1.0
    // C and D are correctly NOT required
    expect(score).toBe(1.0);
  });
});

// ─── computeOrdering ─────────────────────────────────────────────

describe('computeOrdering', () => {
  test('perfect order → 1.0', () => {
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    expect(computeOrdering(agentPath, workflowGraph)).toBe(1.0);
  });

  test('wrong order → ordering drops', () => {
    // Agent went 1 → 3 → 2 → 5 (swapped 2 and 3)
    const agentPath = [node('1'), node('3'), node('2'), node('5')];
    const score = computeOrdering(agentPath, workflowGraph);

    // LVS: 1→3→5 or 1→2→5... longest is 2 valid transitions
    // deduped = [1,3,2,5], dp analysis → score = 0.5
    expect(score).toBe(0.5);
  });

  test('backtracking → NOT severely penalized (consecutive duplicates removed)', () => {
    // Agent went 1 → 2 → 1 → 2 → 3 → 5
    // After dedup: [1,2,1,2,3,5] — no consecutive dups here
    // But 1→2→3→5 is still a valid subsequence of length 4
    const agentPath = [
      node('1'), node('2'), node('1'), node('2'), node('3'), node('5'),
    ];
    const score = computeOrdering(agentPath, workflowGraph);

    // deduped = [1,2,1,2,3,5] (no consecutive dups)
    // LVS = 4 (1→2→3→5), total = 6 → 4/6 ≈ 0.667
    expect(score).toBeCloseTo(0.667, 2);
  });

  test('consecutive duplicate nodes are collapsed', () => {
    // Agent: 1 → 1 → 2 → 2 → 3 → 5
    const agentPath = [
      node('1'), node('1'), node('2'), node('2'), node('3'), node('5'),
    ];
    const score = computeOrdering(agentPath, workflowGraph);

    // deduped = [1, 2, 3, 5] → perfect order → 1.0
    expect(score).toBe(1.0);
  });

  test('no start node first → 20% penalty', () => {
    // Agent started at node 2 instead of node 1
    const agentPath = [node('2'), node('3'), node('5')];
    const score = computeOrdering(agentPath, workflowGraph);

    // deduped = [2, 3, 5], LVS: 2→3 valid, 3→5 valid → 3/3 = 1.0
    // Then × 0.8 penalty = 0.8
    expect(score).toBeCloseTo(0.8);
  });

  test('off-workflow segments are excluded from ordering', () => {
    const agentPath = [node('1'), offWorkflow(), node('2'), node('3'), node('5')];
    expect(computeOrdering(agentPath, workflowGraph)).toBe(1.0);
  });

  test('single node → perfect ordering', () => {
    const agentPath = [node('1')];
    expect(computeOrdering(agentPath, workflowGraph)).toBe(1.0);
  });

  test('empty agentPath → perfect ordering', () => {
    expect(computeOrdering([], workflowGraph)).toBe(1.0);
  });
});

// ─── computeQuality ──────────────────────────────────────────────

describe('computeQuality', () => {
  test('all full → 1.0', () => {
    const agentPath = [node('1', 'full'), node('2', 'full'), node('3', 'full')];
    expect(computeQuality(agentPath)).toBe(1.0);
  });

  test('all partial → 0.5', () => {
    const agentPath = [
      node('1', 'partial'), node('2', 'partial'), node('3', 'partial'),
    ];
    expect(computeQuality(agentPath)).toBe(0.5);
  });

  test('all none → 0.0', () => {
    const agentPath = [node('1', 'none'), node('2', 'none')];
    expect(computeQuality(agentPath)).toBe(0.0);
  });

  test('mixed quality → correct average', () => {
    // full(1.0) + partial(0.5) + full(1.0) + none(0.0) = 2.5 / 4 = 0.625
    const agentPath = [
      node('1', 'full'), node('2', 'partial'), node('3', 'full'), node('5', 'none'),
    ];
    expect(computeQuality(agentPath)).toBe(0.625);
  });

  test('off-workflow segments are excluded from quality', () => {
    const agentPath = [node('1', 'full'), offWorkflow('graceful'), node('2', 'full')];
    expect(computeQuality(agentPath)).toBe(1.0);
  });

  test('only off-workflow → 0 (no on-workflow nodes to rate)', () => {
    const agentPath = [offWorkflow(), offWorkflow()];
    expect(computeQuality(agentPath)).toBe(0);
  });

  // ── Ratio-based scoring (when qualityCriteria is present) ──

  test('ratio-based: 4/5 criteria met → 0.8', () => {
    const agentPath = [{
      nodeIds: ['1'],
      quality: 'partial',
      recovery: null,
      qualityCriteria: {
        met: [{ criterion: 'A' }, { criterion: 'B' }, { criterion: 'C' }, { criterion: 'D' }],
        not_met: [{ criterion: 'E', reason: 'missed' }],
      },
    }];
    expect(computeQuality(agentPath)).toBeCloseTo(0.8);
  });

  test('ratio-based: 1/5 criteria met → 0.2', () => {
    const agentPath = [{
      nodeIds: ['1'],
      quality: 'partial',
      recovery: null,
      qualityCriteria: {
        met: [{ criterion: 'A' }],
        not_met: [{ criterion: 'B' }, { criterion: 'C' }, { criterion: 'D' }, { criterion: 'E' }],
      },
    }];
    expect(computeQuality(agentPath)).toBeCloseTo(0.2);
  });

  test('ratio-based: 5/5 criteria met → 1.0', () => {
    const agentPath = [{
      nodeIds: ['1'],
      quality: 'full',
      recovery: null,
      qualityCriteria: {
        met: [{ criterion: 'A' }, { criterion: 'B' }, { criterion: 'C' }, { criterion: 'D' }, { criterion: 'E' }],
        not_met: [],
      },
    }];
    expect(computeQuality(agentPath)).toBe(1.0);
  });

  test('ratio-based: averages across multiple nodes', () => {
    const agentPath = [
      {
        nodeIds: ['1'], quality: 'full', recovery: null,
        qualityCriteria: { met: [{ criterion: 'A' }, { criterion: 'B' }], not_met: [] },
      },
      {
        nodeIds: ['2'], quality: 'partial', recovery: null,
        qualityCriteria: { met: [{ criterion: 'C' }], not_met: [{ criterion: 'D' }] },
      },
    ];
    // Node 1: 2/2 = 1.0, Node 2: 1/2 = 0.5, average = 0.75
    expect(computeQuality(agentPath)).toBeCloseTo(0.75);
  });

  test('ratio-based: falls back to label when criteria empty', () => {
    const agentPath = [{
      nodeIds: ['1'],
      quality: 'partial',
      recovery: null,
      qualityCriteria: { met: [], not_met: [] },
    }];
    // Empty criteria → falls through to label-based: partial = 0.5
    expect(computeQuality(agentPath)).toBe(0.5);
  });
});

// ─── computeRecovery ─────────────────────────────────────────────

describe('computeRecovery', () => {
  test('no off-workflow segments → 1.0 (not penalized)', () => {
    const agentPath = [node('1'), node('2'), node('3')];
    expect(computeRecovery(agentPath)).toBe(1.0);
  });

  test('graceful recovery → 1.0', () => {
    const agentPath = [node('1'), offWorkflow('graceful'), node('2')];
    expect(computeRecovery(agentPath)).toBe(1.0);
  });

  test('adequate recovery → 0.5', () => {
    const agentPath = [node('1'), offWorkflow('adequate'), node('2')];
    expect(computeRecovery(agentPath)).toBe(0.5);
  });

  test('poor recovery → 0.0', () => {
    const agentPath = [node('1'), offWorkflow('poor'), node('2')];
    expect(computeRecovery(agentPath)).toBe(0.0);
  });

  test('mixed recovery → correct average', () => {
    // graceful(1.0) + poor(0.0) = 1.0 / 2 = 0.5
    const agentPath = [
      node('1'), offWorkflow('graceful'), offWorkflow('poor'), node('2'),
    ];
    expect(computeRecovery(agentPath)).toBe(0.5);
  });
});

// ─── computeLatency ──────────────────────────────────────────────

describe('computeLatency', () => {
  test('fast responses (avg ≤ 5s) → score 1.0', () => {
    const transcript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 3, end: 5 },     // gap: 1s
      { role: 'user', beginning: 6, end: 8 },
      { role: 'assistant', beginning: 10, end: 12 },    // gap: 2s
    ];
    const result = computeLatency(transcript);

    expect(result.score).toBe(1.0);
    expect(result.avg).toBe(1.5);
    expect(result.max).toBe(2);
    expect(result.violations).toBe(0);
    expect(result.all).toEqual([1, 2]);
  });

  test('moderate responses (avg 5–10s) → score 0.75', () => {
    const transcript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 9, end: 12 },     // gap: 7s
      { role: 'user', beginning: 13, end: 15 },
      { role: 'assistant', beginning: 23, end: 26 },    // gap: 8s
    ];
    const result = computeLatency(transcript);

    expect(result.score).toBe(0.75);
    expect(result.avg).toBe(7.5);
  });

  test('slow responses (avg 10–15s) → score 0.5', () => {
    const transcript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 14, end: 18 },    // gap: 12s
      { role: 'user', beginning: 20, end: 22 },
      { role: 'assistant', beginning: 35, end: 40 },    // gap: 13s
    ];
    const result = computeLatency(transcript);

    expect(result.score).toBe(0.5);
    expect(result.avg).toBe(12.5);
  });

  test('very slow responses (avg > 15s) → score 0.25', () => {
    const transcript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 22, end: 25 },    // gap: 20s
      { role: 'user', beginning: 26, end: 28 },
      { role: 'assistant', beginning: 48, end: 52 },    // gap: 20s
    ];
    const result = computeLatency(transcript);

    expect(result.score).toBe(0.25);
    expect(result.avg).toBe(20);
  });

  test('counts violations (gaps > 10s)', () => {
    const transcript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 4, end: 6 },      // gap: 2s  (ok)
      { role: 'user', beginning: 7, end: 9 },
      { role: 'assistant', beginning: 21, end: 25 },    // gap: 12s (violation)
      { role: 'user', beginning: 26, end: 28 },
      { role: 'assistant', beginning: 30, end: 32 },    // gap: 2s  (ok)
    ];
    const result = computeLatency(transcript);

    expect(result.violations).toBe(1);
    expect(result.max).toBe(12);
  });

  test('only assistant turns (no user→assistant pairs) → defaults', () => {
    const transcript = [
      { role: 'assistant', beginning: 0, end: 5 },
      { role: 'assistant', beginning: 6, end: 10 },
    ];
    const result = computeLatency(transcript);

    expect(result.score).toBe(1.0);
    expect(result.all).toEqual([]);
  });

  test('boundary: avg exactly 5s → score 1.0', () => {
    const transcript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 7, end: 10 },     // gap: 5s
    ];
    expect(computeLatency(transcript).score).toBe(1.0);
  });
});

// ─── computeEfficiency ───────────────────────────────────────────

describe('computeEfficiency', () => {
  // Helper: creates a minimal transcript with n turns
  function makeTranscript(numTurns, durationSecs = 100) {
    const turns = [];
    const interval = durationSecs / numTurns;
    for (let i = 0; i < numTurns; i++) {
      turns.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        beginning: i * interval,
        end: (i + 1) * interval,
      });
    }
    return turns;
  }

  test('excellent efficiency (≤ 4 turns/node) → score 1.0', () => {
    // 8 turns for 4-node happy path = 2 turns/node
    const transcript = makeTranscript(8);
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    const result = computeEfficiency(transcript, agentPath, workflowGraph);

    expect(result.score).toBe(1.0);
    expect(result.turnsPerNode).toBe(2);
  });

  test('good efficiency (4–6 turns/node) → score 0.75', () => {
    // 20 turns for 4-node path = 5 turns/node
    const transcript = makeTranscript(20);
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    const result = computeEfficiency(transcript, agentPath, workflowGraph);

    expect(result.score).toBe(0.75);
    expect(result.turnsPerNode).toBe(5);
  });

  test('fair efficiency (6–8 turns/node) → score 0.5', () => {
    // 28 turns for 4-node path = 7 turns/node
    const transcript = makeTranscript(28);
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    const result = computeEfficiency(transcript, agentPath, workflowGraph);

    expect(result.score).toBe(0.5);
    expect(result.turnsPerNode).toBe(7);
  });

  test('poor efficiency (> 8 turns/node) → score 0.25', () => {
    // 40 turns for 4-node path = 10 turns/node
    const transcript = makeTranscript(40);
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    const result = computeEfficiency(transcript, agentPath, workflowGraph);

    expect(result.score).toBe(0.25);
    expect(result.turnsPerNode).toBe(10);
  });

  test('off-workflow segments inflate turn count (correctly penalizing detours)', () => {
    // 24 turns but only 4 workflow nodes → 6 turns/node
    const transcript = makeTranscript(24);
    const agentPath = [node('1'), offWorkflow(), node('2'), node('3'), node('5')];
    const result = computeEfficiency(transcript, agentPath, workflowGraph);

    expect(result.turnsPerNode).toBe(6);
    expect(result.score).toBe(0.75);
  });

  test('reports correct duration', () => {
    const transcript = [
      { role: 'user', beginning: 1.2, end: 1.7 },
      { role: 'assistant', beginning: 2.0, end: 6.89 },
      { role: 'user', beginning: 9.71, end: 12.48 },
      { role: 'assistant', beginning: 12.56, end: 100.0 },
    ];
    const agentPath = [node('1'), node('2'), node('3'), node('5')];
    const result = computeEfficiency(transcript, agentPath, workflowGraph);

    expect(result.duration).toBeCloseTo(98.8);
    expect(result.totalTurns).toBe(4);
  });
});

// ─── computeAdherenceScore ───────────────────────────────────────

describe('computeAdherenceScore', () => {
  test('perfect scores → 100', () => {
    const scores = {
      completeness: 1.0,
      ordering: 1.0,
      quality: 1.0,
      recovery: 1.0,
    };
    expect(computeAdherenceScore(scores)).toBe(100);
  });

  test('all zeros → 0', () => {
    const scores = {
      completeness: 0,
      ordering: 0,
      quality: 0,
      recovery: 0,
    };
    expect(computeAdherenceScore(scores)).toBe(0);
  });

  test('matches expected output from design doc', () => {
    // From the design doc: completeness=1.0, ordering=1.0, quality=0.875, recovery=1.0
    // = (1.0*0.30 + 1.0*0.25 + 0.875*0.25 + 1.0*0.20) * 100 = 96.875 → 97
    const scores = {
      completeness: 1.0,
      ordering: 1.0,
      quality: 0.875,
      recovery: 1.0,
    };
    expect(computeAdherenceScore(scores)).toBe(97);
  });

  test('weights sum correctly for mixed values', () => {
    // completeness=0.5*0.30 + ordering=0.5*0.25 + quality=0.5*0.25 + recovery=0.5*0.20
    // = 0.5 * (0.30+0.25+0.25+0.20) = 0.5 * 1.0 = 0.5 → 50
    const scores = {
      completeness: 0.5,
      ordering: 0.5,
      quality: 0.5,
      recovery: 0.5,
    };
    expect(computeAdherenceScore(scores)).toBe(50);
  });
});

// ─── computePerformanceScore ─────────────────────────────────────

describe('computePerformanceScore', () => {
  test('perfect scores → 100', () => {
    expect(computePerformanceScore({ latency: 1.0, efficiency: 1.0 })).toBe(100);
  });

  test('all zeros → 0', () => {
    expect(computePerformanceScore({ latency: 0, efficiency: 0 })).toBe(0);
  });

  test('matches design doc example: latency=0.5, efficiency=0.5 → 50', () => {
    expect(computePerformanceScore({ latency: 0.5, efficiency: 0.5 })).toBe(50);
  });

  test('unequal scores weighted correctly', () => {
    // latency=1.0*0.5 + efficiency=0.0*0.5 = 0.5 → 50
    expect(computePerformanceScore({ latency: 1.0, efficiency: 0.0 })).toBe(50);
  });
});

// ─── Cross-cutting: Design doc scenarios ─────────────────────────

describe('design doc scenarios', () => {
  test('high adherence + bad performance → scores separate correctly', () => {
    // Perfect workflow but slow responses
    const agentPath = [
      node('1', 'full'), node('2', 'full'), node('3', 'full'), node('5', 'full'),
    ];

    const completeness = computeCompleteness(agentPath, workflowGraph);
    const ordering = computeOrdering(agentPath, workflowGraph);
    const quality = computeQuality(agentPath);
    const recovery = computeRecovery(agentPath);

    const adherence = computeAdherenceScore({
      completeness, ordering, quality, recovery,
    });

    // Slow transcript for performance
    const slowTranscript = [
      { role: 'user', beginning: 0, end: 2 },
      { role: 'assistant', beginning: 22, end: 25 },    // 20s gap
      { role: 'user', beginning: 26, end: 28 },
      { role: 'assistant', beginning: 48, end: 52 },    // 20s gap
      { role: 'user', beginning: 53, end: 55 },
      { role: 'assistant', beginning: 75, end: 80 },    // 20s gap
      { role: 'user', beginning: 81, end: 83 },
      { role: 'assistant', beginning: 103, end: 108 },  // 20s gap
    ];

    const latencyResult = computeLatency(slowTranscript);
    const efficiencyResult = computeEfficiency(slowTranscript, agentPath, workflowGraph);

    const performance = computePerformanceScore({
      latency: latencyResult.score,
      efficiency: efficiencyResult.score,
    });

    // Adherence should be high, performance should be significantly lower
    // latency=0.25 (avg 20s), efficiency=1.0 (2 turns/node) → performance=63
    expect(adherence).toBe(100);
    expect(performance).toBeLessThan(adherence);
    expect(latencyResult.score).toBe(0.25);
  });
});
