import { parseEstimationResponse } from '../utils/schema.js';

const MODEL_IDS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

// No prompt text is sent; strict responseSchema enforces JSON output shape.

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
  constructor({ fetchImpl, timeoutMs = 15000 } = {}) {
    // Ensure fetch is correctly bound to the global object to avoid Illegal invocation in some browsers
    const globalFetch = typeof globalThis !== 'undefined' ? globalThis.fetch : undefined;
    const rawFetch = fetchImpl || globalFetch;
    if (!rawFetch) {
      throw new Error('Fetch implementation not available');
    }
    this.fetchImpl = rawFetch === globalFetch && typeof rawFetch === 'function' ? rawFetch.bind(globalThis) : rawFetch;
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

    const startedAt = performance.now?.() ?? Date.now();
    const payload = {
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
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
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
      const response = await this.fetchImpl(url, requestOptions);
      const duration = (performance.now?.() ?? Date.now()) - startedAt;
      console.debug('[CalorieCam] Gemini HTTP response', { status: response.status, ms: Math.round(duration) });
      if (!response.ok) {
        const textBody = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
        const error = new Error('ESTIMATION_HTTP_ERROR');
        error.status = response.status;
        error.code = 'HTTP';
        error.details = textBody?.slice(0, 500) || '';
        console.error('[CalorieCam] Gemini HTTP error', { status: error.status, details: error.details });
        throw error;
      }
      const json = await response.json();
      const finishReason = json?.candidates?.[0]?.finishReason;
      const usage = json?.usageMetadata;
      const text = extractText(json);
      if (!text) {
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
        const e = new Error('ESTIMATION_EMPTY_RESPONSE');
        e.code = 'EMPTY';
        e.details = JSON.stringify(diag).slice(0, 500);
        throw e;
      }
      try {
        const parsed = JSON.parse(text);
        return parseEstimationResponse(parsed);
      } catch (cause) {
        const e = new Error('ESTIMATION_SCHEMA_ERROR');
        e.code = 'SCHEMA';
        e.cause = cause;
        throw e;
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error('ESTIMATION_TIMEOUT');
        e.code = 'TIMEOUT';
        throw e;
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async runDemo(sampleResponse) {
    return parseEstimationResponse(sampleResponse);
  }
}
