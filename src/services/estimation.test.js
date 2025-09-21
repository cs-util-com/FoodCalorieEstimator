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

  test('surfaces schema error on malformed JSON without retry', async () => {
    // Why: With simplified logic, malformed responses throw a schema error immediately.
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"oops": true}' }] } }] }),
    });
    const service = new EstimationService({ fetchImpl });
    await expect(service.estimate({ imageBlob: createFakeBlob(), apiKey: 'abc123' })).rejects.toThrow('ESTIMATION_SCHEMA_ERROR');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  // Removed retries: no separate test for exceeding retries; schema error occurs on first attempt.

  test('retries once on MAX_TOKENS empty response and succeeds', async () => {
    // Why: With capped thinking and larger output, we still guard with a single retry on truncation.
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
    const service = new EstimationService({ fetchImpl });
    const result = await service.estimate({ imageBlob: createFakeBlob(), apiKey: 'key' });
    expect(result.version).toBe('1.1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
