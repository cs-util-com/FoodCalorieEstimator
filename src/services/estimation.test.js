import { EstimationService } from './estimation.js';

const SAMPLE_RESPONSE = {
  version: '1.1',
  model_id: 'gemini-2.5',
  meal_confidence: 'high',
  total_kcal: 500,
  items: [
    { name: 'Pasta', kcal: 400, confidence: 0.8, estimated_grams: null, used_scale_ref: false, scale_ref: null, bbox_1000: null, notes: null },
  ],
};

function createFakeBlob(type = 'image/jpeg') {
  const buffer = Uint8Array.from([1, 2, 3, 4]).buffer;
  return {
    type,
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

describe('EstimationService', () => {
  test('posts image payload and parses JSON output', async () => {
    // Why: Confirms the Gemini call contract and schema enforcement.
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(SAMPLE_RESPONSE) }],
                },
              },
            ],
          }),
      }),
    );
    const service = new EstimationService({ fetchImpl });
    const blob = createFakeBlob();
    const result = await service.estimate({ imageBlob: blob, apiKey: 'abc123', modelVariant: 'pro' });
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.total_kcal).toBe(500);
  });

  test('retries once on schema violation', async () => {
    // Why: Matches the spec requirement to retry on malformed responses once.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"oops": true}' }] } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(SAMPLE_RESPONSE) }],
                },
              },
            ],
          }),
      });

    const service = new EstimationService({ fetchImpl, maxSchemaRetries: 1 });
    const blob = createFakeBlob();
    const result = await service.estimate({ imageBlob: blob, apiKey: 'abc123' });
    expect(result.items[0].name).toBe('Pasta');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('throws when API key missing', async () => {
    // Why: Settings gate should prevent network calls without a key.
    const service = new EstimationService({ fetchImpl: jest.fn() });
    await expect(service.estimate({ imageBlob: createFakeBlob(), apiKey: '' })).rejects.toThrow('MISSING_API_KEY');
  });

  test('propagates HTTP errors', async () => {
    // Why: UI needs to show meaningful errors on provider failures.
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
    const service = new EstimationService({ fetchImpl });
    await expect(service.estimate({ imageBlob: createFakeBlob(), apiKey: 'key' })).rejects.toThrow('ESTIMATION_HTTP_ERROR');
  });

  test('fails after exceeding schema retries', async () => {
    // Why: After retrying once the service surfaces a schema error for logging.
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"oops": true}' }] } }] }),
      }),
    );
    const service = new EstimationService({ fetchImpl, maxSchemaRetries: 1 });
    await expect(service.estimate({ imageBlob: createFakeBlob(), apiKey: 'key' })).rejects.toThrow('ESTIMATION_SCHEMA_ERROR');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('retries with compact prompt on MAX_TOKENS empty response', async () => {
    // Why: Ensures we handle empty text with finishReason=MAX_TOKENS by retrying with more tokens and compact prompt.
    const emptyWithMaxTokens = {
      candidates: [
        {
          finishReason: 'MAX_TOKENS',
          content: { parts: [] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 700,
        totalTokenCount: 1000,
        thoughtsTokenCount: 100,
      },
    };
    const okWithJson = {
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(SAMPLE_RESPONSE) }] },
        },
      ],
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(emptyWithMaxTokens) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okWithJson) });
    const service = new EstimationService({ fetchImpl, maxSchemaRetries: 1 });
    const blob = createFakeBlob();
    const result = await service.estimate({ imageBlob: blob, apiKey: 'key' });
    expect(result.version).toBe('1.1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
