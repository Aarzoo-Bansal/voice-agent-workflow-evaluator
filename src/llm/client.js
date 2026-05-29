/**
 * LLM Client for Workflow Verification Engine
 *
 * Thin wrapper around the OpenAI SDK that provides:
 *   - Structured output via JSON schema enforcement (not prompt-based)
 *   - Exponential backoff retry for transient API failures
 *   - Centralized model/temperature config from config.js
 *
 * Two entry points:
 *   callLLM()           — free-form text response (used by Pass 3: summary)
 *   callLLMStructured() — JSON schema-enforced response (used by Pass 1 & 2)
 *
 * Both accept a system prompt, user prompt, and model name.
 * Structured calls additionally accept a JSON schema and a schema name.
 */

require('dotenv').config();
const OpenAI = require('openai');
const { LLM_CONFIG } = require('../config');

// ─── Client Initialization ───────────────────────────────────────

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─── Retry Logic ─────────────────────────────────────────────────

/**
 * Retries an async operation with exponential backoff.
 *
 * Delay doubles on each attempt: retryDelayMs, 2×, 4×, ...
 * Only retries on thrown errors (API failures, network issues).
 * Does NOT retry on successful responses with unexpected content —
 * that's a prompt/schema problem, not a transient failure.
 *
 * @param {Function} fn         - Async function to attempt
 * @param {number}   maxRetries - Maximum number of retry attempts
 * @param {number}   delayMs    - Initial delay between retries in milliseconds
 * @returns {Promise<*>} Result of the first successful call
 * @throws {Error} The last error if all retries are exhausted
 */
async function withRetry(fn, maxRetries = LLM_CONFIG.maxRetries, delayMs = LLM_CONFIG.retryDelayMs) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on non-transient errors (auth, bad request, etc.)
      const status = error?.status || error?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }

      // If we still have retries left, wait with exponential backoff
      if (attempt < maxRetries) {
        const backoff = delayMs * Math.pow(2, attempt);
        console.warn(
          `LLM call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms...`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw lastError;
}

// ─── Free-form LLM Call ──────────────────────────────────────────

/**
 * Makes an LLM call that returns a free-form text response.
 * Used by Pass 3 (qualitative summary) where structured output
 * is unnecessary — we just need a human-readable paragraph.
 *
 * @param {Object} options
 * @param {string} options.systemPrompt - System message setting the LLM's role
 * @param {string} options.userPrompt   - User message with the actual task
 * @param {string} options.model        - Model ID (e.g. 'gpt-4o')
 * @returns {Promise<string>} The assistant's text response
 */
async function callLLM({ systemPrompt, userPrompt, model }) {
  const response = await withRetry(() =>
    openai.chat.completions.create({
      model,
      temperature: LLM_CONFIG.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
  );

  return response.choices[0].message.content;
}

// ─── Structured LLM Call ─────────────────────────────────────────

/**
 * Makes an LLM call with JSON schema enforcement.
 * Used by Pass 1 (segmentation) and Pass 2 (classification).
 *
 * The OpenAI API validates the response against the provided schema
 * at the API level — no manual JSON parsing or validation needed.
 * This eliminates "malformed LLM JSON" as a failure mode.
 *
 * @param {Object} options
 * @param {string} options.systemPrompt - System message setting the LLM's role
 * @param {string} options.userPrompt   - User message with the actual task
 * @param {string} options.model        - Model ID (e.g. 'gpt-4o-mini')
 * @param {string} options.schemaName   - Name for the response format schema
 * @param {Object} options.schema       - JSON Schema object defining the expected response shape
 * @returns {Promise<Object>} Parsed JSON object conforming to the schema
 */
async function callLLMStructured({ systemPrompt, userPrompt, model, schemaName, schema }) {
  const response = await withRetry(() =>
    openai.chat.completions.create({
      model,
      temperature: LLM_CONFIG.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    })
  );

  return JSON.parse(response.choices[0].message.content);
}

module.exports = {
  callLLM,
  callLLMStructured,
};
