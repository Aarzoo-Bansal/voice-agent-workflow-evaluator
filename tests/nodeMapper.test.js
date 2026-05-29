/**
 * Tests for Node Mapper (src/engine/nodeMapper.js)
 *
 * Mocks the LLM client to test orchestration logic:
 *   - classifySegment: single segment classification with context windowing
 *   - mapSegmentsToNodes: parallel classification of all segments
 *
 * Also verifies:
 *   - Low confidence → needsReview flag
 *   - Segment metadata is attached to results
 *   - Previous segment summary is passed correctly
 *   - All segments are classified in parallel
 */

const { classifySegment, mapSegmentsToNodes } = require('../src/engine/nodeMapper');

// Mock the LLM client
jest.mock('../src/llm/client', () => ({
  callLLMStructured: jest.fn(),
}));

const { callLLMStructured } = require('../src/llm/client');

// ─── Shared Fixtures ─────────────────────────────────────────────

const workflowNodes = [
  { id: '1', type: 'start', data: { label: 'Introduction', description: 'Greet the caller' } },
  { id: '2', type: 'decision', data: { label: 'Appointment Type', description: 'Determine appointment type' } },
  { id: '3', type: 'end', data: { label: 'Wrap-up', description: 'Confirm and close' } },
];

const transcript = [
  { role: 'user', content: 'Hello?', beginning: 0, end: 1 },
  { role: 'assistant', content: 'Welcome to NexaCare.', beginning: 2, end: 5 },
  { role: 'user', content: 'I need a checkup.', beginning: 6, end: 8 },
  { role: 'assistant', content: 'Sure, a general checkup.', beginning: 9, end: 12 },
  { role: 'user', content: 'Sounds good.', beginning: 13, end: 14 },
  { role: 'assistant', content: 'All set. Goodbye!', beginning: 15, end: 17 },
];

const segments = [
  { segmentId: 1, startTurnIndex: 0, endTurnIndex: 1, summary: 'Greeting and intro' },
  { segmentId: 2, startTurnIndex: 2, endTurnIndex: 3, summary: 'Appointment type discussion' },
  { segmentId: 3, startTurnIndex: 4, endTurnIndex: 5, summary: 'Confirmation and closing' },
];

// Helper: builds a mock LLM classification response
function mockClassification({ nodeIds, confidence = 0.9, quality = 'full', recovery = null }) {
  return {
    nodeIds,
    confidence,
    quality,
    qualityCriteria: quality ? { met: [], not_met: [] } : null,
    recovery,
    recoveryCriteria: recovery ? { met: [], not_met: [] } : null,
    needsReview: false,
    justification: 'Test classification',
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

// ─── classifySegment ─────────────────────────────────────────────

describe('classifySegment', () => {
  test('returns classification with segment metadata attached', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['1'] }));

    const result = await classifySegment(segments[0], 'None', transcript, workflowNodes);

    expect(result.nodeIds).toEqual(['1']);
    expect(result.segmentId).toBe(1);
    expect(result.startTurnIndex).toBe(0);
    expect(result.endTurnIndex).toBe(1);
  });

  test('flags low confidence as needsReview', async () => {
    // Confidence 0.4 is below CONFIDENCE_THRESHOLD (0.6)
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: ['2'], confidence: 0.4 })
    );

    const result = await classifySegment(segments[1], 'Greeting', transcript, workflowNodes);

    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe(0.4);
  });

  test('high confidence does not override needsReview to true', async () => {
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: ['1'], confidence: 0.95 })
    );

    const result = await classifySegment(segments[0], 'None', transcript, workflowNodes);

    expect(result.needsReview).toBe(false);
  });

  test('passes correct model and schema to LLM', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['1'] }));

    await classifySegment(segments[0], 'None', transcript, workflowNodes);

    const callArgs = callLLMStructured.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.schemaName).toBe('classification_response');
    expect(callArgs.schema).toBeDefined();
  });

  test('user prompt includes workflow nodes and segment turns', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['1'] }));

    await classifySegment(segments[0], 'None', transcript, workflowNodes);

    const callArgs = callLLMStructured.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('Node 1 [start]');
    expect(callArgs.userPrompt).toContain('Node 2 [decision]');
    expect(callArgs.userPrompt).toContain('[Turn 0] user: Hello?');
    expect(callArgs.userPrompt).toContain('[Turn 1] assistant: Welcome to NexaCare.');
  });

  test('user prompt includes previous segment context', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['2'] }));

    await classifySegment(segments[1], 'Greeting and intro', transcript, workflowNodes);

    const callArgs = callLLMStructured.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('Previous segment context: Greeting and intro');
  });

  test('handles off_workflow classification', async () => {
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: ['off_workflow'], quality: null, recovery: 'graceful' })
    );

    const result = await classifySegment(segments[0], 'None', transcript, workflowNodes);

    expect(result.nodeIds).toEqual(['off_workflow']);
    expect(result.quality).toBeNull();
    expect(result.recovery).toBe('graceful');
  });

  test('handles multi-label classification (segment spans two nodes)', async () => {
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: ['2', '3'] })
    );

    const result = await classifySegment(segments[2], 'Appointment type', transcript, workflowNodes);

    expect(result.nodeIds).toEqual(['2', '3']);
  });

  test('normalizes "Node 1" → "1" in LLM response', async () => {
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: ['Node 1'] })
    );

    const result = await classifySegment(segments[0], 'None', transcript, workflowNodes);

    expect(result.nodeIds).toEqual(['1']);
  });

  test('normalizes whitespace in node IDs', async () => {
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: [' 2 '] })
    );

    const result = await classifySegment(segments[1], 'Greeting', transcript, workflowNodes);

    expect(result.nodeIds).toEqual(['2']);
  });

  test('preserves "off_workflow" through normalization', async () => {
    callLLMStructured.mockResolvedValue(
      mockClassification({ nodeIds: ['off_workflow'], quality: null, recovery: 'graceful' })
    );

    const result = await classifySegment(segments[0], 'None', transcript, workflowNodes);

    expect(result.nodeIds).toEqual(['off_workflow']);
  });
});

// ─── mapSegmentsToNodes ──────────────────────────────────────────

describe('mapSegmentsToNodes', () => {
  test('classifies all segments and returns results in order', async () => {
    callLLMStructured
      .mockResolvedValueOnce(mockClassification({ nodeIds: ['1'] }))
      .mockResolvedValueOnce(mockClassification({ nodeIds: ['2'] }))
      .mockResolvedValueOnce(mockClassification({ nodeIds: ['3'] }));

    const results = await mapSegmentsToNodes(segments, transcript, workflowNodes);

    expect(results).toHaveLength(3);
    expect(results[0].nodeIds).toEqual(['1']);
    expect(results[1].nodeIds).toEqual(['2']);
    expect(results[2].nodeIds).toEqual(['3']);
  });

  test('fires all LLM calls in parallel (called 3 times)', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['1'] }));

    await mapSegmentsToNodes(segments, transcript, workflowNodes);

    expect(callLLMStructured).toHaveBeenCalledTimes(3);
  });

  test('first segment gets "None" as previous context', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['1'] }));

    await mapSegmentsToNodes(segments, transcript, workflowNodes);

    const firstCallPrompt = callLLMStructured.mock.calls[0][0].userPrompt;
    expect(firstCallPrompt).toContain('None (this is the first segment)');
  });

  test('subsequent segments get previous segment summary as context', async () => {
    callLLMStructured.mockResolvedValue(mockClassification({ nodeIds: ['2'] }));

    await mapSegmentsToNodes(segments, transcript, workflowNodes);

    // Second call should have first segment's summary
    const secondCallPrompt = callLLMStructured.mock.calls[1][0].userPrompt;
    expect(secondCallPrompt).toContain('Greeting and intro');

    // Third call should have second segment's summary
    const thirdCallPrompt = callLLMStructured.mock.calls[2][0].userPrompt;
    expect(thirdCallPrompt).toContain('Appointment type discussion');
  });

  test('each result has segment metadata attached', async () => {
    // Must return fresh objects — classifySegment mutates the result to attach metadata
    callLLMStructured.mockImplementation(() =>
      Promise.resolve(mockClassification({ nodeIds: ['1'] }))
    );

    const results = await mapSegmentsToNodes(segments, transcript, workflowNodes);

    expect(results[0].segmentId).toBe(1);
    expect(results[1].segmentId).toBe(2);
    expect(results[2].segmentId).toBe(3);
    expect(results[2].startTurnIndex).toBe(4);
    expect(results[2].endTurnIndex).toBe(5);
  });

  test('propagates LLM errors', async () => {
    callLLMStructured.mockRejectedValue(new Error('API timeout'));

    await expect(mapSegmentsToNodes(segments, transcript, workflowNodes))
      .rejects.toThrow('API timeout');
  });
});
