/**
 * The two halves of harfbuzzjs 0.x that `utils/textShaping` loads directly.
 *
 * The package ships no types for them. These are only the members the shaper
 * uses — see node_modules/harfbuzzjs/hbjs.js for the rest.
 */
declare module 'harfbuzzjs/hb.js' {
  /** The Emscripten factory: instantiates the WebAssembly module. */
  const createHarfBuzz: (options?: { wasmBinary?: ArrayBuffer | Uint8Array }) => Promise<unknown>;
  export default createHarfBuzz;
}

declare module 'harfbuzzjs/hbjs.js' {
  export interface HbBlob { destroy(): void }
  export interface HbFace { upem: number; destroy(): void }
  export interface HbFont { destroy(): void }
  /** One glyph of shaped output, as `buffer.json()` serialises it. */
  export interface HbGlyph {
    /** Glyph id. */
    g: number;
    /** The UTF-16 offset of the cluster this glyph belongs to. */
    cl: number;
    ax: number;
    ay: number;
    dx: number;
    dy: number;
    flags: number;
  }
  export interface HbBuffer {
    addText(text: string): void;
    setDirection(direction: 'ltr' | 'rtl' | 'ttb' | 'btt'): void;
    setScript(script: string): void;
    guessSegmentProperties(): void;
    json(): HbGlyph[];
    destroy(): void;
  }
  export interface HarfBuzz {
    createBlob(data: ArrayBuffer | Uint8Array): HbBlob;
    createFace(blob: HbBlob, index: number): HbFace;
    createFont(face: HbFace): HbFont;
    createBuffer(): HbBuffer;
    shape(font: HbFont, buffer: HbBuffer, features?: string): void;
  }
  const hbjs: (module: unknown) => HarfBuzz;
  export default hbjs;
}
