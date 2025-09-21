import { ImageCanvas, scaleBox } from './image-canvas.js';

describe('scaleBox', () => {
  test('scales bbox from 1000-space to canvas', () => {
    // Why: Ensures overlay aligns with provider coordinates.
    const result = scaleBox({ x: 100, y: 200, w: 300, h: 400 }, 500, 400);
    expect(result).toMatchObject({ x: 50, y: 80, w: 150, h: 160 });
  });
});

describe('ImageCanvas', () => {
  beforeEach(() => {
    global.createImageBitmap = jest.fn(() =>
      Promise.resolve({
        width: 1000,
        height: 800,
        close: jest.fn(),
      }),
    );
  });

  test('draws overlay boxes when enabled', async () => {
    // Why: Bounding boxes are central to the product experience.
    const drawImage = jest.fn();
    const clearRect = jest.fn();
    const overlay = document.createElement('div');
    const canvas = {
      width: 640,
      height: 480,
      getContext: () => ({ drawImage, clearRect }),
    };
    const widget = new ImageCanvas(canvas, overlay);
    const blob = new Blob(['x']);
    await widget.render({
      blob,
      width: 1000,
      height: 800,
      items: [{ name: 'Toast', confidence: 0.8, bbox: { x: 0, y: 0, w: 500, h: 500 } }],
      showBoxes: true,
    });
    expect(drawImage).toHaveBeenCalled();
    expect(overlay.children).toHaveLength(1);
  });
});
