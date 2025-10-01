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

  test('positions boxes using CSS-scaled canvas size', async () => {
    // Why: The canvas is displayed at CSS size differing from its internal buffer.
    const drawImage = jest.fn();
    const clearRect = jest.fn();
    const overlay = document.createElement('div');
    const canvas = {
      width: 640,
      height: 480,
      clientWidth: 320, // CSS downscaled by 0.5
      clientHeight: 240,
      getContext: () => ({ drawImage, clearRect }),
    };
    const widget = new ImageCanvas(canvas, overlay);
    const blob = new Blob(['x']);

    await widget.render({
      blob,
      width: 1000,
      height: 800,
      items: [{ name: 'Item', confidence: 0.5, bbox: { x: 100, y: 100, w: 200, h: 200 } }],
      showBoxes: true,
    });

    // Because 1000x800 (5:4) into 640x480 (4:3) is height-constrained (scale=0.6),
    // the drawn width is 600 with 20px internal letterbox on each side.
    // CSS scale is 0.5, so box dimensions map accordingly.
    const box = overlay.children[0];
    // width = 0.2 * (drawWidth=600) * cssScale(0.5) = 60px
    expect(box.style.width).toBe(`60px`);
    // height = 0.2 * (drawHeight=480) * cssScale(0.5) = 48px
    expect(box.style.height).toBe(`48px`);
    expect(box.style.boxSizing).toBe('border-box');
  });
});
