export class PreprocessService {
  constructor({
    maxLongEdge = 1536,
    thumbLongEdge = 512,
    quality = 0.8,
    // Bind to globalThis to avoid "Illegal invocation" when called as a bare function
    createImageBitmapFn = globalThis.createImageBitmap
      ? globalThis.createImageBitmap.bind(globalThis)
      : null,
    canvasFactory = () => globalThis.document?.createElement('canvas'),
  } = {}) {
    this.maxLongEdge = maxLongEdge;
    this.thumbLongEdge = thumbLongEdge;
    this.quality = quality;
    this.createImageBitmapFn = createImageBitmapFn;
    this.canvasFactory = canvasFactory;
  }

  async preprocess(file) {
    if (!file) {
      throw new Error('A file must be provided for preprocessing');
    }

    const bitmap = await this.#loadBitmap(file);
    const mainDimensions = this.#scale(bitmap.width, bitmap.height, this.maxLongEdge);
    const normalizedBlob = await this.#drawAndExport(bitmap, mainDimensions.width, mainDimensions.height, this.quality);
    const thumbDimensions = this.#scale(mainDimensions.width, mainDimensions.height, this.thumbLongEdge);
    const thumbBlob = await this.#drawAndExport(bitmap, thumbDimensions.width, thumbDimensions.height, 0.7);

    bitmap.close?.();

    return {
      normalizedBlob,
      thumbBlob,
      width: mainDimensions.width,
      height: mainDimensions.height,
    };
  }

  async #loadBitmap(file) {
    if (this.createImageBitmapFn) {
      // Try with options that respect EXIF orientation first
      try {
        return await this.createImageBitmapFn(file, { imageOrientation: 'from-image' });
      } catch (e1) {
        // Some engines don't support the options dictionary; try without options
        try {
          return await this.createImageBitmapFn(file);
        } catch (e2) {
          // Log once to aid debugging in browsers where this fails
          console.warn('createImageBitmap failed, falling back to <img> loader', e2 || e1);
        }
      }
    }

    return this.#loadWithImg(file);
  }

  async #loadWithImg(file) {
    // Fallback for environments without createImageBitmap (e.g., some Safari builds)
    // Add a timeout to avoid hanging forever on rare image decode stalls.
    const timeoutMs = 15000;
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        let done = false;
        const cleanup = () => {
          done = true;
          clearTimeout(timer);
        };
        const onLoad = () => {
          cleanup();
          resolve(img);
        };
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const timer = setTimeout(() => {
          if (!done) {
            onError(new Error('Image load timeout'));
          }
        }, timeoutMs);
        img.onload = onLoad;
        img.onerror = onError;
        // Hint decoders in supporting browsers; harmless elsewhere
        try { img.decoding = 'async'; } catch {} // eslint-disable-line no-empty
        img.src = url;
      });
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  #scale(width, height, targetLongEdge) {
    const longest = Math.max(width, height);
    if (longest <= targetLongEdge) {
      return { width, height };
    }
    const scale = targetLongEdge / longest;
    return {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    };
  }

  async #drawAndExport(bitmap, width, height, quality) {
    const canvas = this.canvasFactory();
    if (!canvas) {
      throw new Error('Canvas factory must return a canvas element');
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext?.('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') {
      throw new Error('Canvas 2D context is unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const type = this.#getPreferredImageType(canvas);

    // Prefer toBlob as it's widely supported and has deterministic callback semantics
    if (typeof canvas.toBlob === 'function') {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to export canvas blob'));
          } else {
            resolve(blob);
          }
        }, type, quality);
      });
    }

    // Fallback to convertToBlob
    if (typeof canvas.convertToBlob === 'function') {
      try {
        return await canvas.convertToBlob({ type, quality });
      } catch (e) {
        throw new Error(`Canvas blob export failed: ${e?.message || e}`);
      }
    }

    throw new Error('Canvas does not support blob export');
  }

  #getPreferredImageType(canvas) {
    // Prefer WebP; if explicitly unsupported, fall back to PNG
    try {
      if (typeof canvas?.toDataURL === 'function') {
        const data = canvas.toDataURL('image/webp');
        if (typeof data === 'string' && data.startsWith('data:image/webp')) {
          return 'image/webp';
        }
        // Some engines return image/png data URL when asked for webp – treat as unsupported
        if (typeof data === 'string' && data.startsWith('data:image/png')) {
          return 'image/png';
        }
      }
    } catch {
      // Ignore errors; default below
    }
    return 'image/webp';
  }
}
