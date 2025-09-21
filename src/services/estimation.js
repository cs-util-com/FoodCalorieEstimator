import { parseEstimationResponse } from '../utils/schema.js';

const MODEL_IDS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

const PROMPT = `You are a nutrition analyst.
Analyze the attached meal photo and return only a valid JSON object (no prose, no markdown, no comments).
Use concise values and short strings. Output JSON only.`;

// Ultra-compact fallback prompt used when we hit MAX_TOKENS and get empty text
const COMPACT_PROMPT = `Return JSON only with: version:"1.1", model_id:"gemini-2.5", meal_confidence:(very-low|low|medium|high|very-high), total_kcal:int, items:[{name, kcal:int, confidence:0-1, estimated_grams:int|null, used_scale_ref:bool, scale_ref:(fork|spoon|credit_card|plate|chopsticks|other|null), bbox_1000:{x:int,y:int,w:int,h:int}|null, notes:string|null}].`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'string', enum: ['1.1'] },
    model_id: { type: 'string', enum: ['gemini-2.5'] },
    meal_confidence: { type: 'string', enum: ['very-low', 'low', 'medium', 'high', 'very-high'] },
    total_kcal: { type: 'integer' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kcal: { type: 'integer' },
          confidence: { type: 'number' },
          estimated_grams: { type: 'integer' },
          used_scale_ref: { type: 'boolean' },
          scale_ref: { type: 'string', enum: ['fork', 'spoon', 'credit_card', 'plate', 'chopsticks', 'other'] },
          bbox_1000: {
            type: 'object',
            properties: {
              x: { type: 'integer' },
              y: { type: 'integer' },
              w: { type: 'integer' },
              h: { type: 'integer' },
            },
          },
          notes: { type: 'string' },
        },
        required: ['name', 'kcal', 'confidence'],
      },
    },
  },
  required: ['version', 'model_id', 'meal_confidence', 'total_kcal', 'items'],
};

async function blobToBase64(blob) {
  const arrayBuffer =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : typeof Response !== 'undefined'
      ? await new Response(blob).arrayBuffer()
      : (() => {
          throw new Error('Unsupported blob conversion');
        })();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function extractText(response) {
  const candidate = response?.candidates?.[0];
  if (!candidate) return null;
  const parts = candidate.content?.parts || [];
  return parts.map((part) => part.text || '').join('').trim();
}

export class EstimationService {
  constructor({ fetchImpl, maxSchemaRetries = 1, timeoutMs = 15000 } = {}) {
    // Ensure fetch is correctly bound to the global object to avoid Illegal invocation in some browsers
    const globalFetch = typeof globalThis !== 'undefined' ? globalThis.fetch : undefined;
    const rawFetch = fetchImpl || globalFetch;
    if (!rawFetch) {
      throw new Error('Fetch implementation not available');
    }
    this.fetchImpl = rawFetch === globalFetch && typeof rawFetch === 'function' ? rawFetch.bind(globalThis) : rawFetch;
    this.maxSchemaRetries = maxSchemaRetries;
    this.timeoutMs = timeoutMs;
  }

  async estimate({ imageBlob, apiKey, modelVariant = 'flash' }) {
    if (!imageBlob) {
      throw new Error('Image blob is required');
    }
    if (!apiKey) {
      throw new Error('MISSING_API_KEY');
    }

    const modelId = MODEL_IDS[modelVariant] || MODEL_IDS.flash;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
    const imageData = await blobToBase64(imageBlob);

    let attempt = 0;
    let forceOmitSchema = false; // set to true only if API rejects responseSchema with 400
    let lastError = null;
    let nextMaxTokens = 1500; // start generous to reduce empty outputs
    let useCompactPrompt = false; // flip on if MAX_TOKENS occurs
    while (attempt <= this.maxSchemaRetries) {
      attempt += 1;
      const startedAt = performance.now?.() ?? Date.now();
      // Build payload per attempt to allow fallback on retry
      const useFallback = attempt > 1;
      const omitSchema = forceOmitSchema === true;
      const systemText = useCompactPrompt ? COMPACT_PROMPT : PROMPT;
      const payload = {
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemText }],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: imageBlob.type || 'image/jpeg',
                  data: imageData,
                },
              },
              { text: 'Return valid JSON only per the schema.' },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: nextMaxTokens,
          responseMimeType: 'application/json',
          ...(!omitSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
        },
      };
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = this.timeoutMs && controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
      try {
        const requestOptions = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller?.signal,
        };
        let response;
        try {
          response = await this.fetchImpl(url, requestOptions);
        } catch (invokeErr) {
          // Fallback: some environments throw Illegal invocation if fetch isn't bound
          const msg = String(invokeErr?.message || '');
          if (msg.includes('Illegal invocation') && typeof globalThis?.fetch === 'function') {
            const bound = globalThis.fetch.bind(globalThis);
            response = await bound(url, requestOptions);
          } else {
            throw invokeErr;
          }
        }
        const duration = (performance.now?.() ?? Date.now()) - startedAt;
        console.debug('[CalorieCam] Gemini HTTP response', { status: response.status, attempt, ms: Math.round(duration) });
        if (!response.ok) {
          const textBody = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
          // If the first attempt fails with 400, retry once without responseSchema (some deployments reject it)
          if (response.status === 400 && !useFallback) {
            console.warn('[CalorieCam] Gemini 400 on first attempt; retrying without responseSchema', {
              status: response.status,
              body: textBody?.slice(0, 300) || '',
            });
            lastError = new Error('ESTIMATION_HTTP_400_RETRY');
            lastError.code = 'HTTP';
            lastError.status = response.status;
            lastError.details = textBody?.slice(0, 500) || '';
            forceOmitSchema = true;
            // Go to next loop iteration (will set useFallback=true)
            continue;
          }
          const error = new Error('ESTIMATION_HTTP_ERROR');
          error.status = response.status;
          error.code = 'HTTP';
          error.details = textBody?.slice(0, 500) || '';
          console.error('[CalorieCam] Gemini HTTP error', { status: error.status, attempt, details: error.details });
          throw error;
        }
        const json = await response.json();
        const finishReason = json?.candidates?.[0]?.finishReason;
        const usage = json?.usageMetadata;
        const text = extractText(json);
        if (!text) {
          // Provide diagnostic info when provider responds without text
          const diag = {
            finishReason,
            promptFeedback: json?.promptFeedback,
            usage: usage
              ? {
                  prompt: usage?.promptTokenCount,
                  candidates: usage?.candidatesTokenCount,
                  total: usage?.totalTokenCount,
                  thoughts: usage?.thoughtsTokenCount,
                }
              : undefined,
          };
          console.warn('[CalorieCam] Empty Gemini response', diag);
          // If we ran out of tokens, try once more with a higher limit and compact prompt
          if (finishReason === 'MAX_TOKENS' && nextMaxTokens < 2048) {
            nextMaxTokens = 2048;
            useCompactPrompt = true;
            lastError = new Error('ESTIMATION_EMPTY_RESPONSE_MAX_TOKENS_RETRY');
            lastError.code = 'EMPTY';
            lastError.details = JSON.stringify(diag).slice(0, 500);
            continue;
          }
          lastError = new Error('ESTIMATION_EMPTY_RESPONSE');
          lastError.code = 'EMPTY';
          lastError.details = JSON.stringify(diag).slice(0, 500);
          continue;
        }
        try {
          const parsed = JSON.parse(text);
          return parseEstimationResponse(parsed);
        } catch (cause) {
          lastError = cause;
          if (attempt > this.maxSchemaRetries) {
            const wrapped = new Error('ESTIMATION_SCHEMA_ERROR');
            wrapped.code = 'SCHEMA';
            wrapped.cause = cause;
            throw wrapped;
          }
        }
      } catch (err) {
        // Distinguish abort/timeout, network, and HTTP (re-thrown above)
        if (err?.name === 'AbortError') {
          const e = new Error('ESTIMATION_TIMEOUT');
          e.code = 'TIMEOUT';
          lastError = e;
        } else if (err?.code === 'HTTP' || err?.message === 'ESTIMATION_HTTP_ERROR') {
          // Bubble up HTTP errors immediately (don’t retry on schema for HTTP failures)
          throw err;
        } else if (err?.code === 'SCHEMA' || err?.message === 'ESTIMATION_SCHEMA_ERROR') {
          // Surface schema errors as-is (after retries exhausted)
          throw err;
        } else {
          const e = new Error('ESTIMATION_NETWORK_ERROR');
          e.code = 'NETWORK';
          e.cause = err;
          lastError = e;
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    throw lastError || new Error('ESTIMATION_UNKNOWN_ERROR');
  }

  async runDemo(sampleResponse) {
    return parseEstimationResponse(sampleResponse);
  }
}
