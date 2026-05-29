/**
 * Test transcripts for segmenter validation.
 * 
 * These test different segmentation scenarios. For each transcript,
 * the expected segments are documented so you can verify the LLM's
 * output makes sense.
 * 
 * Usage:
 *   node tests/test-segmenter.js [clean|offworkflow|messy|minimal]
 */

const { segmentTranscript } = require('../src/engine/segmenter');
const exampleGraph = require('../data/example-graph.json');

// ─── Test 1: Clean conversation (no detours) ────────────────────
// Expected segments: 4 (greeting, type determination, scheduling, confirmation)

const cleanTranscript = [
  { role: "user", content: "Hi there.", beginning: 0.5, end: 1.0 },
  { role: "assistant", content: "Thank you for calling NexaCare. This is Riley, your scheduling assistant. How may I help you today?", beginning: 1.5, end: 5.0 },
  { role: "user", content: "I need to schedule a general checkup. I'm a new patient.", beginning: 5.5, end: 8.0 },
  { role: "assistant", content: "I'd be happy to help you schedule a general checkup. Do you have a preference for a specific provider?", beginning: 8.5, end: 12.0 },
  { role: "user", content: "No preference. First available is fine.", beginning: 12.5, end: 14.0 },
  { role: "assistant", content: "Great. Since you're a new patient, could I please get your full name, date of birth, and a contact number?", beginning: 14.5, end: 18.0 },
  { role: "user", content: "Sarah Johnson, March 10 1992, 555-0123.", beginning: 18.5, end: 21.0 },
  { role: "assistant", content: "Thank you, Sarah. I have an available slot with Dr. Patel on Wednesday, December 4th at 2 PM. Does that work for you?", beginning: 21.5, end: 26.0 },
  { role: "user", content: "That works perfectly.", beginning: 26.5, end: 27.5 },
  { role: "assistant", content: "Wonderful. Your appointment is confirmed with Dr. Patel on Wednesday, December 4th at 2 PM. Please arrive 15 minutes early to fill out new patient paperwork. We'll send you a confirmation and reminder. Is there anything else I can help with?", beginning: 28.0, end: 35.0 },
  { role: "user", content: "No, that's all. Thank you!", beginning: 35.5, end: 36.5 },
  { role: "assistant", content: "Thank you for scheduling with NexaCare, Sarah. Have a great day!", beginning: 37.0, end: 39.0 },
];

// Expected segments:
// 1. Turns 0-1: Greeting / Introduction
// 2. Turns 2-4: Appointment type determination (new patient, general checkup, no provider pref)
// 3. Turns 5-8: Scheduling (name, DOB, contact, time offered, confirmed)
// 4. Turns 9-11: Confirmation and wrap-up

// ─── Test 2: Off-workflow detour ─────────────────────────────────
// Expected segments: 5 (greeting, complaint detour, type determination, scheduling, confirmation)

const offWorkflowTranscript = [
  { role: "user", content: "Hello.", beginning: 0.5, end: 1.0 },
  { role: "assistant", content: "Thank you for calling NexaCare. This is Riley, your scheduling assistant. How may I help you today?", beginning: 1.5, end: 5.0 },
  { role: "user", content: "Yeah, I want to complain first. Last time I called, I was on hold for 30 minutes.", beginning: 6.0, end: 10.0 },
  { role: "assistant", content: "I'm really sorry to hear about that experience. That's not the level of service we aim for. I'll make a note of your feedback. Is there anything specific I can help resolve from that experience?", beginning: 10.5, end: 16.0 },
  { role: "user", content: "No, I just wanted someone to know. Anyway, I need to book an appointment.", beginning: 17.0, end: 20.0 },
  { role: "assistant", content: "Absolutely, I'd be happy to help you with that. What type of appointment are you looking for?", beginning: 20.5, end: 23.0 },
  { role: "user", content: "Just a routine physical. I've been here before.", beginning: 23.5, end: 26.0 },
  { role: "assistant", content: "A routine physical for a returning patient. Could I get your full name and date of birth to pull up your records?", beginning: 26.5, end: 30.0 },
  { role: "user", content: "Mike Chen, July 22 1988.", beginning: 30.5, end: 33.0 },
  { role: "assistant", content: "Thank you, Mike. I found your records. I have a slot available with Dr. Williams on Friday at 10 AM. Would that work?", beginning: 33.5, end: 38.0 },
  { role: "user", content: "Friday works. Let's do it.", beginning: 38.5, end: 40.0 },
  { role: "assistant", content: "Perfect. You're all set for Friday at 10 AM with Dr. Williams. No special preparation needed for a routine physical. We'll send you a reminder the day before. Is there anything else?", beginning: 40.5, end: 47.0 },
  { role: "user", content: "Nope, we're good.", beginning: 47.5, end: 48.5 },
  { role: "assistant", content: "Thank you for calling NexaCare, Mike. Have a great day!", beginning: 49.0, end: 51.0 },
];

// Expected segments:
// 1. Turns 0-1: Greeting / Introduction
// 2. Turns 2-4: Off-workflow complaint about hold time
// 3. Turns 5-6: Appointment type determination (routine physical, returning)
// 4. Turns 7-10: Scheduling (name, DOB, records found, time confirmed)
// 5. Turns 11-13: Confirmation and wrap-up

// ─── Test 3: Messy conversation (multiple issues) ────────────────
// Expected segments: 6+ (greeting, billing confusion, redirect, type determination, scheduling, confirmation)

const messyTranscript = [
  { role: "user", content: "Hi, is this billing?", beginning: 0.5, end: 2.0 },
  { role: "assistant", content: "Thank you for calling NexaCare. This is Riley, your scheduling assistant. I handle appointment scheduling. For billing questions, I can transfer you. How can I help?", beginning: 2.5, end: 8.0 },
  { role: "user", content: "Oh wait, actually I need both. I got a weird charge on my bill AND I need to reschedule my appointment.", beginning: 9.0, end: 14.0 },
  { role: "assistant", content: "I understand. For the billing charge, I'd recommend calling our billing department directly at 555-0199. They can look into that for you. I can definitely help with rescheduling your appointment though. Shall we start with that?", beginning: 14.5, end: 22.0 },
  { role: "user", content: "Fine, let's do the appointment.", beginning: 23.0, end: 24.5 },
  { role: "assistant", content: "Great. Are you looking to reschedule an existing appointment or book a new one?", beginning: 25.0, end: 28.0 },
  { role: "user", content: "Reschedule. I have one next Tuesday but I can't make it anymore.", beginning: 28.5, end: 31.0 },
  { role: "assistant", content: "I can help with that. Could I get your full name and date of birth so I can find your appointment?", beginning: 31.5, end: 35.0 },
  { role: "user", content: "Lisa Park, September 3 1995.", beginning: 35.5, end: 38.0 },
  { role: "assistant", content: "Thank you, Lisa. I see your appointment with Dr. Carter next Tuesday at 3 PM. When would work better for you?", beginning: 38.5, end: 43.0 },
  { role: "user", content: "Anything Thursday or Friday.", beginning: 43.5, end: 45.0 },
  { role: "assistant", content: "I have Thursday at 11 AM or Friday at 9 AM with Dr. Carter. Which do you prefer?", beginning: 45.5, end: 49.0 },
  { role: "user", content: "Thursday 11 AM.", beginning: 49.5, end: 50.5 },
  { role: "assistant", content: "Done. I've rescheduled your appointment to Thursday at 11 AM with Dr. Carter. Your Tuesday appointment has been cancelled. We'll send you an updated confirmation. Is there anything else?", beginning: 51.0, end: 57.0 },
  { role: "user", content: "No, but I'm still calling billing about that charge.", beginning: 57.5, end: 60.0 },
  { role: "assistant", content: "Absolutely. The billing number is 555-0199. Thank you for calling NexaCare, Lisa!", beginning: 60.5, end: 64.0 },
];

// Expected segments:
// 1. Turns 0-1: Greeting (confused about department)
// 2. Turns 2-4: Off-workflow billing discussion, redirect
// 3. Turns 5-6: Appointment type determination (reschedule, existing patient)
// 4. Turns 7-12: Scheduling (name, DOB, find appointment, offer times, confirm)
// 5. Turns 13-15: Confirmation and wrap-up (with billing reminder)

// ─── Test 4: Minimal conversation ────────────────────────────────
// Expected segments: 2-3 (greeting that merges into scheduling, confirmation)

const minimalTranscript = [
  { role: "user", content: "I need an appointment tomorrow.", beginning: 0.5, end: 2.0 },
  { role: "assistant", content: "Thank you for calling NexaCare. This is Riley. I'd be happy to help. Could I get your name and date of birth?", beginning: 2.5, end: 6.0 },
  { role: "user", content: "Tom Wilson, April 5 1980. I'm a returning patient.", beginning: 6.5, end: 9.0 },
  { role: "assistant", content: "Thank you, Tom. I have a slot tomorrow at 3 PM with Dr. Lee. Shall I book that?", beginning: 9.5, end: 13.0 },
  { role: "user", content: "Yes please.", beginning: 13.5, end: 14.0 },
  { role: "assistant", content: "You're confirmed for tomorrow at 3 PM with Dr. Lee. We'll send a reminder. Anything else?", beginning: 14.5, end: 18.0 },
  { role: "user", content: "No thanks.", beginning: 18.5, end: 19.0 },
  { role: "assistant", content: "Thank you, Tom. Have a great day!", beginning: 19.5, end: 21.0 },
];

// Expected segments:
// 1. Turns 0-1: Greeting + immediate type determination (merged — very fast conversation)
// 2. Turns 2-4: Scheduling (name, DOB, time offered, confirmed)
// 3. Turns 5-7: Confirmation and wrap-up
// Note: This tests whether the segmenter handles a conversation where
//       the agent skips formal steps because the user front-loads info.

// ─── Runner ──────────────────────────────────────────────────────

const transcripts = {
  clean: { name: 'Clean conversation', data: cleanTranscript, expectedSegments: 4 },
  offworkflow: { name: 'Off-workflow detour', data: offWorkflowTranscript, expectedSegments: 5 },
  messy: { name: 'Messy conversation', data: messyTranscript, expectedSegments: 5 },
  minimal: { name: 'Minimal conversation', data: minimalTranscript, expectedSegments: 3 },
};

async function runTest(key) {
  const test = transcripts[key];
  if (!test) {
    console.error(`Unknown test: ${key}. Options: ${Object.keys(transcripts).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${test.name}`);
  console.log(`Turns: ${test.data.length}`);
  console.log(`Expected segments: ~${test.expectedSegments}`);
  console.log('='.repeat(60));

  try {
    const segments = await segmentTranscript(test.data, exampleGraph.nodes);

    console.log(`\nGot ${segments.length} segments:\n`);
    for (const seg of segments) {
      console.log(`  Segment ${seg.segmentId}: turns ${seg.startTurnIndex}-${seg.endTurnIndex}`);
      console.log(`    Summary: ${seg.summary}`);
    }

    // Basic validation
    console.log('\n--- Validation ---');

    // Check coverage: every turn should be in exactly one segment
    const coveredTurns = new Set();
    for (const seg of segments) {
      for (let i = seg.startTurnIndex; i <= seg.endTurnIndex; i++) {
        if (coveredTurns.has(i)) {
          console.log(`  ✗ Turn ${i} appears in multiple segments`);
        }
        coveredTurns.add(i);
      }
    }
    const allCovered = coveredTurns.size === test.data.length;
    console.log(`  ${allCovered ? '✓' : '✗'} All ${test.data.length} turns covered: ${coveredTurns.size}/${test.data.length}`);

    // Check ordering: segments should be in order
    let ordered = true;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].startTurnIndex <= segments[i - 1].endTurnIndex) {
        ordered = false;
        console.log(`  ✗ Segment ${i} overlaps with segment ${i - 1}`);
      }
    }
    if (ordered) console.log('  ✓ Segments are in order with no overlaps');

    // Check no gaps
    let noGaps = true;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].startTurnIndex !== segments[i - 1].endTurnIndex + 1) {
        noGaps = false;
        console.log(`  ✗ Gap between segment ${i - 1} and ${i}`);
      }
    }
    if (noGaps) console.log('  ✓ No gaps between segments');

    // Check summaries exist
    const allSummaries = segments.every((s) => s.summary && s.summary.length > 0);
    console.log(`  ${allSummaries ? '✓' : '✗'} All segments have summaries`);

    // Segment count comparison
    const diff = Math.abs(segments.length - test.expectedSegments);
    if (diff === 0) console.log(`  ✓ Segment count matches expected (${test.expectedSegments})`);
    else if (diff <= 1) console.log(`  ~ Segment count close to expected (got ${segments.length}, expected ~${test.expectedSegments})`);
    else console.log(`  ✗ Segment count off (got ${segments.length}, expected ~${test.expectedSegments})`);

  } catch (err) {
    console.error(`\n  ✗ Error: ${err.message}`);
  }
}

// Run specific test or all
const testKey = process.argv[2];

if (testKey) {
  runTest(testKey);
} else {
  console.log('Running all segmenter tests...');
  (async () => {
    for (const key of Object.keys(transcripts)) {
      await runTest(key);
    }
  })();
}