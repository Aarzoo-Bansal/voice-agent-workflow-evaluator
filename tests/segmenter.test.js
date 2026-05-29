/**
 * Tests for Segmenter (src/engine/segmenter.js)
 *
 * Two categories:
 *   1. validateSegments — pure deterministic, no mocks needed
 *   2. segmentTranscript — mocks the LLM client to test orchestration
 */

const { validateSegments, segmentTranscript } = require('../src/engine/segmenter');

// ─── validateSegments ────────────────────────────────────────────

describe('validateSegments', () => {
  test('valid contiguous segments → passes', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 1, summary: 'Greeting' },
      { segmentId: 2, startTurnIndex: 2, endTurnIndex: 5, summary: 'Complaint' },
      { segmentId: 3, startTurnIndex: 6, endTurnIndex: 9, summary: 'Scheduling' },
    ];
    const result = validateSegments(segments, 10);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('single segment covering all turns → passes', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 3, summary: 'Entire conversation' },
    ];
    const result = validateSegments(segments, 4);

    expect(result.valid).toBe(true);
  });

  test('empty segments array → fails', () => {
    const result = validateSegments([], 5);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No segments returned');
  });

  test('null segments → fails', () => {
    const result = validateSegments(null, 5);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No segments returned');
  });

  test('first segment does not start at 0 → fails', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 1, endTurnIndex: 3, summary: 'Late start' },
    ];
    const result = validateSegments(segments, 4);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/starts at turn 1, expected 0/);
  });

  test('last segment does not end at final turn → fails', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 2, summary: 'Early end' },
    ];
    const result = validateSegments(segments, 5);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/ends at turn 2, expected 4/);
  });

  test('gap between segments → fails', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 2, summary: 'First' },
      { segmentId: 2, startTurnIndex: 4, endTurnIndex: 5, summary: 'Second' },
    ];
    const result = validateSegments(segments, 6);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Gap or overlap'))).toBe(true);
  });

  test('overlapping segments → fails', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 3, summary: 'First' },
      { segmentId: 2, startTurnIndex: 2, endTurnIndex: 5, summary: 'Overlapping' },
    ];
    const result = validateSegments(segments, 6);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Gap or overlap'))).toBe(true);
  });

  test('start > end within a segment → fails', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 3, endTurnIndex: 0, summary: 'Inverted' },
    ];
    const result = validateSegments(segments, 4);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('start (3) > end (0)'))).toBe(true);
  });

  test('out-of-bounds index → fails', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 10, summary: 'Too far' },
    ];
    const result = validateSegments(segments, 5);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('out-of-bounds'))).toBe(true);
  });

  test('unordered segments are sorted before validation', () => {
    // Segments arrive out of order but are still valid
    const segments = [
      { segmentId: 3, startTurnIndex: 6, endTurnIndex: 7, summary: 'Third' },
      { segmentId: 1, startTurnIndex: 0, endTurnIndex: 2, summary: 'First' },
      { segmentId: 2, startTurnIndex: 3, endTurnIndex: 5, summary: 'Second' },
    ];
    const result = validateSegments(segments, 8);

    expect(result.valid).toBe(true);
  });

  test('multiple errors are all reported', () => {
    const segments = [
      { segmentId: 1, startTurnIndex: 1, endTurnIndex: 2, summary: 'Bad start' },
      // Gap here (turn 3 missing)
      { segmentId: 2, startTurnIndex: 4, endTurnIndex: 5, summary: 'Bad end gap' },
    ];
    const result = validateSegments(segments, 10);

    // Should catch: bad start, gap between segments, bad end
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── segmentTranscript (with mocked LLM) ────────────────────────

// Mock the LLM client to avoid real API calls in tests
jest.mock('../src/llm/client', () => ({
  callLLMStructured: jest.fn(),
}));

const { callLLMStructured } = require('../src/llm/client');

describe('segmentTranscript', () => {
  const transcript = [
    { role: 'user', content: 'Hello?', beginning: 1.2, end: 1.7 },
    { role: 'assistant', content: 'Welcome to NexaCare.', beginning: 2.0, end: 5.0 },
    { role: 'user', content: 'I need an appointment.', beginning: 6.0, end: 8.0 },
    { role: 'assistant', content: 'Sure, let me help.', beginning: 9.0, end: 11.0 },
  ];

  const workflowNodes = [
    { id: '1', data: { label: 'Introduction', description: 'Greet the caller.' }, type: 'start' },
    { id: '2', data: { label: 'Scheduling', description: 'Book an appointment.' }, type: 'end' },
  ];

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns validated segments from LLM response', async () => {
    callLLMStructured.mockResolvedValue({
      segments: [
        { segmentId: 1, startTurnIndex: 0, endTurnIndex: 1, summary: 'Greeting and intro' },
        { segmentId: 2, startTurnIndex: 2, endTurnIndex: 3, summary: 'Appointment request' },
      ],
    });

    const segments = await segmentTranscript(transcript, workflowNodes);

    expect(segments).toHaveLength(2);
    expect(segments[0].summary).toBe('Greeting and intro');
    expect(segments[1].startTurnIndex).toBe(2);
  });

  test('calls LLM with correct model and schema', async () => {
    callLLMStructured.mockResolvedValue({
      segments: [
        { segmentId: 1, startTurnIndex: 0, endTurnIndex: 3, summary: 'Full conversation' },
      ],
    });

    await segmentTranscript(transcript, workflowNodes);

    expect(callLLMStructured).toHaveBeenCalledTimes(1);
    const callArgs = callLLMStructured.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o-mini');
    expect(callArgs.schemaName).toBe('segmentation_response');
    expect(callArgs.schema).toBeDefined();
    expect(callArgs.systemPrompt).toContain('conversation analyst');
  });

  test('auto-repairs small gaps in segments from LLM', async () => {
    // LLM returns segments with a small gap (turn 1 missing) — should be auto-repaired
    callLLMStructured.mockResolvedValue({
      segments: [
        { segmentId: 1, startTurnIndex: 0, endTurnIndex: 0, summary: 'First' },
        { segmentId: 2, startTurnIndex: 2, endTurnIndex: 3, summary: 'Skipped turn 1' },
      ],
    });

    const result = await segmentTranscript(transcript, workflowNodes);
    // Gap repaired: segment 1 extended to cover turn 1
    expect(result[0].endTurnIndex).toBe(1);
    expect(result[1].startTurnIndex).toBe(2);
  });

  test('throws on large gaps in segments from LLM', async () => {
    // LLM returns segments with a large gap (3 turns missing) — should still throw
    callLLMStructured.mockResolvedValue({
      segments: [
        { segmentId: 1, startTurnIndex: 0, endTurnIndex: 0, summary: 'First' },
        { segmentId: 2, startTurnIndex: 4, endTurnIndex: 5, summary: 'Big gap' },
      ],
    });

    // Need a 6-turn transcript for this test
    const longTranscript = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${i}`,
      beginning: i * 2,
      end: i * 2 + 1,
    }));

    await expect(segmentTranscript(longTranscript, workflowNodes)).rejects.toThrow('invalid segments');
  });

  test('throws on empty segments from LLM', async () => {
    callLLMStructured.mockResolvedValue({ segments: [] });

    await expect(segmentTranscript(transcript, workflowNodes)).rejects.toThrow('invalid segments');
  });

  test('user prompt includes all turns with indices', async () => {
    callLLMStructured.mockResolvedValue({
      segments: [
        { segmentId: 1, startTurnIndex: 0, endTurnIndex: 3, summary: 'All' },
      ],
    });

    await segmentTranscript(transcript, workflowNodes);

    const callArgs = callLLMStructured.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('[Turn 0] user: Hello?');
    expect(callArgs.userPrompt).toContain('[Turn 3] assistant: Sure, let me help.');
  });
});
