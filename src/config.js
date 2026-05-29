// Workflow Verification Engine — Configuration
// Weights, thresholds, and constants

// --- Scoring Weights ---

// Workflow Adherence Score weights (must sum to 1.0)
// Answers: "Did the agent follow the workflow correctly?"
const ADHERENCE_WEIGHTS = {
  completeness: 0.30,
  ordering: 0.25,
  quality: 0.25,
  recovery: 0.20,
};

// Performance Score weights (must sum to 1.0)
// Answers: "How well did the agent perform mechanically?"
const PERFORMANCE_WEIGHTS = {
  latency: 0.50,
  efficiency: 0.50,
};

// --- Quality & Recovery Mappings ---

const QUALITY_MAP = {
  full: 1.0,
  partial: 0.5,
  none: 0.0,
};

const RECOVERY_MAP = {
  graceful: 1.0,
  adequate: 0.5,
  poor: 0.0,
};

// --- Thresholds ---

// Confidence below this triggers needs_review flag
const CONFIDENCE_THRESHOLD = 0.6;

// Max nodes a single segment can map to
const MAX_LABELS_PER_SEGMENT = 2;

// --- Latency Scoring Thresholds (seconds) ---

const LATENCY_THRESHOLDS = {
  excellent: 5,   // <= 5s  → score 1.0
  good: 10,       // <= 10s → score 0.75
  fair: 15,       // <= 15s → score 0.5
                   // > 15s  → score 0.25
};

// Latency violation threshold (seconds) — gaps above this are flagged
const LATENCY_VIOLATION_THRESHOLD = 10;

// --- Efficiency Scoring Thresholds (turns per required node) ---

const EFFICIENCY_THRESHOLDS = {
  excellent: 4,   // <= 4  → score 1.0
  good: 6,        // <= 6  → score 0.75
  fair: 8,        // <= 8  → score 0.5
                   // > 8   → score 0.25
};

// --- Penalties ---

// Applied to completeness when conversation doesn't reach an end node
const NO_END_NODE_PENALTY = 0.7;

// Applied to ordering when conversation doesn't start at start node
const NO_START_NODE_PENALTY = 0.8;

// --- LLM Configuration ---

const LLM_CONFIG = {
  segmentationModel: 'gpt-4o-mini',  // Cheaper model for Pass 1 (simpler task)
  classificationModel: 'gpt-4o',      // Powerful model for Pass 2 (needs reasoning)
  summaryModel: 'gpt-4o',             // Powerful model for Pass 3
  criteriaExtractionModel: 'gpt-4o-mini', // Lightweight model for criteria extraction
  temperature: 0,
  maxRetries: 3,
  retryDelayMs: 1000,
};

module.exports = {
  ADHERENCE_WEIGHTS,
  PERFORMANCE_WEIGHTS,
  QUALITY_MAP,
  RECOVERY_MAP,
  CONFIDENCE_THRESHOLD,
  MAX_LABELS_PER_SEGMENT,
  LATENCY_THRESHOLDS,
  LATENCY_VIOLATION_THRESHOLD,
  EFFICIENCY_THRESHOLDS,
  NO_END_NODE_PENALTY,
  NO_START_NODE_PENALTY,
  LLM_CONFIG,
};
