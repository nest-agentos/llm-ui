import {afterEach, expect, it, vi} from 'vitest';
import {downscaleImageForOcr} from '../src/image-downscale';
afterEach(() => vi.unstubAllGlobals());
it('keeps small images intact and releases decoded image memory', async () => {
    const image = new Blob(['image'], {type: 'image/png'}), close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width: 800, height: 600, close})));
    expect(await downscaleImageForOcr(image)).toBe(image); expect(close).toHaveBeenCalledOnce();
});
it('retains the source and releases decoded memory when asynchronous encoding fails', async () => {
    const image = new Blob(['image'], {type: 'image/png'}), close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width: 4000, height: 3000, close})));
    vi.stubGlobal('OffscreenCanvas', class {getContext() {return {drawImage() {}};} async convertToBlob() {throw new Error('ENCODING_FAILED');}});
    expect(await downscaleImageForOcr(image)).toBe(image); expect(close).toHaveBeenCalledOnce();
});
