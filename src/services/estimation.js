import { parseEstimationResponse } from '../utils/schema.js';

const MODEL_IDS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

const PROMPT = `You are a nutrition analyst that estimates calories for meals.
Return JSON only. Follow the v1.1 schema with fields: version, model_id, meal_confidence, total_kcal, items[].
Do not include any prose or explanations.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'string' },
    model_id: { type: 'string' },
    meal_confidence: { type: 'string' },
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
          scale_ref: { type: 'string' },
          bbox_1000: {
            type: 'object',
            properties: {
              x: { type: 'integer' },
              y: { type: 'integer' },
              w: { type: 'integer' },
              h: { type: 'integer' },
            },
            additionalProperties: false,
          },
          notes: { type: 'string' },
        },
        required: ['name', 'kcal', 'confidence'],
        additionalProperties: true,
      },
    },
  },
  required: ['version', 'model_id', 'meal_confidence', 'total_kcal', 'items'],
  additionalProperties: true,
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
    let lastError = null;
    while (attempt <= this.maxSchemaRetries) {
      attempt += 1;
      const startedAt = performance.now?.() ?? Date.now();
      // Build payload per attempt to allow fallback on retry
      const useFallback = attempt > 1;
      const payload = {
        systemInstruction: {
          role: 'system',
          parts: [{ text: PROMPT }],
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
              { text: useFallback ? 'Return valid JSON only per the schema.' : 'Analyze this meal photo and return valid JSON only.' },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 900,
          responseMimeType: 'application/json',
          ...(useFallback ? {} : { responseSchema: RESPONSE_SCHEMA }),
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
        const text = extractText(json);
        if (!text) {
          // Provide diagnostic info when provider responds without text
          const diag = {
            finishReason: json?.candidates?.[0]?.finishReason,
            promptFeedback: json?.promptFeedback,
          };
          console.warn('[CalorieCam] Empty Gemini response', diag);
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
