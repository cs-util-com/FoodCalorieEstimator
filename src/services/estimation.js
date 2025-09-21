import { parseEstimationResponse } from '../utils/schema.js';

const MODEL_IDS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

const PROMPT = `You are a nutrition analyst that estimates calories for meals.
Respond with strict JSON matching the provided schema without extra text.`;

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
  constructor({ fetchImpl = fetch, maxSchemaRetries = 1 } = {}) {
    this.fetchImpl = fetchImpl;
    this.maxSchemaRetries = maxSchemaRetries;
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
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
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
        maxOutputTokens: 900,
      },
    };

    let attempt = 0;
    let lastError = null;
    while (attempt <= this.maxSchemaRetries) {
      attempt += 1;
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = new Error('ESTIMATION_HTTP_ERROR');
        error.status = response.status;
        throw error;
      }
      const json = await response.json();
      const text = extractText(json);
      if (!text) {
        lastError = new Error('ESTIMATION_EMPTY_RESPONSE');
        continue;
      }
      try {
        const parsed = JSON.parse(text);
        return parseEstimationResponse(parsed);
      } catch (error) {
        lastError = error;
        if (attempt > this.maxSchemaRetries) {
          const wrapped = new Error('ESTIMATION_SCHEMA_ERROR');
          wrapped.cause = error;
          throw wrapped;
        }
      }
    }
    throw lastError || new Error('ESTIMATION_UNKNOWN_ERROR');
  }

  async runDemo(sampleResponse) {
    return parseEstimationResponse(sampleResponse);
  }
}
