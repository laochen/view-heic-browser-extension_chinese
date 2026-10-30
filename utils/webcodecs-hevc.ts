/**
 * utils/webcodecs-hevc.ts
 *
 * WebCodecs VideoDecoder wrapper for hardware-accelerated HEVC (H.265) decoding.
 *
 * Usage flow:
 *  1. Call isHEVCSupported() → false means fall back to software path.
 *  2. For static HEIC (simple): decodeHevcFrameToURL(sampleData, hvcC) → blob: URL.
 *  3. For static HEIC (grid):   decodeGridTilesToURL(tiles, grid) → blob: URL.
 *  4. For animated HEIC:        decodeHevcFrames(samples, hvcC) → ImageBitmap[] with durations.
 */

import type { HvcCInfo, AnimationSample, GridTile, GridInfo } from './isobmff'
import type { ExifOrientation } from './exif'

// ─── Support Detection ────────────────────────────────────────────────────────

/** Cached result after the first isConfigSupported probe (null = not yet checked). */
let _hevcSupported: boolean | null = null

/**
 * Returns true if the current browser can decode HEVC via WebCodecs VideoDecoder.
 * Probes hardware-accelerated decode first, then software-only as a fallback.
 * Result is memoised – subsequent calls are synchronous.
 */
export async function isHEVCSupported(): Promise<boolean> {
  if (_hevcSupported !== null) return _hevcSupported
  if (typeof VideoDecoder === 'undefined') return (_hevcSupported = false)

  try {
    // HEVC Main profile, Level 4.0 – covers virtually all HEIC content
    const baseConfig = { codec: 'hvc1.1.6.L120.90' } as const

    // Prefer hardware; macOS Chrome 107+ supports this via VideoToolbox
    const hwResult = await VideoDecoder.isConfigSupported({
      ...baseConfig,
      hardwareAcceleration: 'prefer-hardware',
    })
    if (hwResult.supported) return (_hevcSupported = true)

    // Retry without hardware preference (software decode, Chrome on Windows, etc.)
    const swResult = await VideoDecoder.isConfigSupported(baseConfig)
    return (_hevcSupported = swResult.supported ?? false)
  } catch {
    return (_hevcSupported = false)
  }
}

// ─── Orientation Helpers ──────────────────────────────────────────────────────

/**
 * Returns the output (post-transform) dimensions for a given EXIF orientation
 * applied to a source of size `srcW × srcH`.
 *
 * Orientations 5–8 involve a 90° rotation, which swaps width and height.
 * Orientations 1–4 are pure flips/180° rotations and preserve dimensions.
 */
export function orientedOutputSize(
  srcW: number,
  srcH: number,
  orientation: ExifOrientation,
): { width: number; height: number } {
  return orientation >= 5 ? { width: srcH, height: srcW } : { width: srcW, height: srcH }
}

/**
 * Draws `source` (a VideoFrame, ImageBitmap, OffscreenCanvas, …) onto `ctx`
 * with the EXIF `orientation` transformation applied.
 *
 * The target canvas must already be sized to `orientedOutputSize(srcW, srcH)`:
 *   - orientations 1–4 keep `srcW × srcH`
 *   - orientations 5–8 swap to `srcH × srcW` (90° rotation)
 *
 * Implemented purely with canvas transforms (translate/rotate/scale) so it
 * works uniformly for VideoFrame and OffscreenCanvas sources.
 *
 * NOTE: the translate amounts depend on which dimension the rotation maps to.
 * For 90° cases (5–8) the post-rotation canvas is `srcH × srcW`, so the
 * horizontal shift is bounded by `srcH` and the vertical shift by `srcW` —
 * using `srcW`/`srcH` here would leave a black band on one side.
 *
 * Reference: EXIF orientation tag 0x0112, values 1–8.
 */
function applyOrientationDraw(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  orientation: ExifOrientation,
  srcW: number,
  srcH: number,
): void {
  ctx.save()
  switch (orientation) {
    case 1:
      // identity
      break
    case 2: // mirror horizontal
      ctx.translate(srcW, 0)
      ctx.scale(-1, 1)
      break
    case 3: // rotate 180
      ctx.translate(srcW, srcH)
      ctx.rotate(Math.PI)
      break
    case 4: // mirror vertical
      ctx.translate(0, srcH)
      ctx.scale(1, -1)
      break
    case 5: // transpose (mirror horizontal + rotate 90 CW)
      // rotate(π/2): (x,y)→(-y,x); scale(1,-1): (-y,x)→(-y,-x); → dst=(y, x)
      ctx.rotate(Math.PI / 2)
      ctx.scale(1, -1)
      break
    case 6: // rotate 90 CW → dst x ∈ [0, srcH], so translate by srcH
      ctx.translate(srcH, 0)
      ctx.rotate(Math.PI / 2)
      break
    case 7: // transverse (mirror horizontal + rotate 270 CW)
      // rotate(π/2): (-y,x); scale(-1,1): (y,x); → shift to (+srcH, +srcW)
      ctx.translate(srcH, srcW)
      ctx.rotate(Math.PI / 2)
      ctx.scale(-1, 1)
      break
    case 8: // rotate 90 CCW (270 CW) → dst y ∈ [0, srcW], so translate by srcW
      ctx.translate(0, srcW)
      ctx.rotate(-Math.PI / 2)
      break
  }
  ctx.drawImage(source, 0, 0)
  ctx.restore()
}

// ─── Public Decode API ────────────────────────────────────────────────────────

/**
 * Decodes a single HEVC-coded sample (HVCC length-prefixed format) and returns
 * a blob: URL pointing to a PNG-encoded image.
 *
 * Intended for use as a drop-in replacement for heicTo() in the single-frame path.
 */
export async function decodeHevcFrameToURL(
  sampleData: Uint8Array,
  hvcC: HvcCInfo,
  orientation: ExifOrientation = 1,
): Promise<string> {
  const frames = await decodeChunks([{ type: 'key', data: sampleData }], hvcC)

  const frame = frames[0]
  if (!frame) throw new Error('WebCodecs HEVC: decoder produced no output frame')

  // Output dimensions account for any 90° rotation in the EXIF orientation.
  const { width: outW, height: outH } = orientedOutputSize(
    frame.displayWidth,
    frame.displayHeight,
    orientation,
  )

  // Draw to OffscreenCanvas then export as PNG blob
  const canvas = new OffscreenCanvas(outW, outH)
  const ctx = canvas.getContext('2d')!
  applyOrientationDraw(ctx, frame, orientation, frame.displayWidth, frame.displayHeight)
  frame.close()

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return URL.createObjectURL(blob)
}

/**
 * Decodes all tiles of a grid-type HEIC image and stitches them onto a single
 * OffscreenCanvas, then returns a blob: URL of the composited PNG.
 *
 * Tiles that share the same codec string are batched through one VideoDecoder
 * for efficiency.  In practice all iPhone HEIC tiles share one hvcC config,
 * so the entire image is decoded in a single decoder pass.
 *
 * @param tiles  Row-major ordered tile array from `StaticFrameData.tiles`.
 * @param grid   Grid geometry from `StaticFrameData.grid`.
 */
export async function decodeGridTilesToURL(
  tiles: GridTile[],
  grid: GridInfo,
  orientation: ExifOrientation = 1,
): Promise<string> {
  // ── Group consecutive tiles by codec string for batch decoding ────────
  // Each group shares a single VideoDecoder instance to avoid reconfiguration
  // overhead.  In virtually all real-world files all tiles share one codec.
  interface TileGroup {
    hvcC: HvcCInfo
    indices: number[]   // indices into the `tiles` array
  }
  const groups: TileGroup[] = []
  for (let i = 0; i < tiles.length; i++) {
    const last = groups[groups.length - 1]
    if (last && last.hvcC.codecString === tiles[i].hvcC.codecString) {
      last.indices.push(i)
    } else {
      groups.push({ hvcC: tiles[i].hvcC, indices: [i] })
    }
  }
  //console.debug("begin decodeChunks")
  // ── Decode each group and collect VideoFrames keyed by tile index ─────
  const frameMap = new Map<number, VideoFrame>()
  for (const group of groups) {
    const chunks = group.indices.map((tileIdx) => ({
      type: 'key' as const,  // every HEIC tile is an IDR (intra-only) frame
      data: tiles[tileIdx].sampleData,
    }))
    const videoFrames = await decodeChunks(chunks, group.hvcC)
    for (let k = 0; k < videoFrames.length; k++) {
      frameMap.set(group.indices[k], videoFrames[k])
    }
  }
  //console.debug("end decodeChunks")
  if (frameMap.size === 0) {
    throw new Error('WebCodecs HEVC: no tile frames decoded for grid image')
  }

  // ── Stitch tiles onto OffscreenCanvas ────────────────────────────────
  // Canvas is sized to the final output dimensions; edge tiles that extend
  // beyond the canvas boundary are naturally clipped by the browser.
  const stitchCanvas = new OffscreenCanvas(grid.outputWidth, grid.outputHeight)
  const stitchCtx = stitchCanvas.getContext('2d')!

  // Use the decoded frame dimensions as tile step size (matches the hvc1 tile
  // encoding size which may be larger than the output image edges).
  const tileStepW = tiles[0].width
  const tileStepH = tiles[0].height

  for (const [tileIdx, frame] of frameMap) {
    const col = tileIdx % grid.columns
    const row = Math.floor(tileIdx / grid.columns)
    stitchCtx.drawImage(frame, col * tileStepW, row * tileStepH)
    frame.close()
  }
  //console.debug("end drawImage")

  // ── Apply EXIF orientation ────────────────────────────────────────────
  // When orientation != 1, blit the stitched tiles onto a final canvas sized
  // to the post-transform dimensions, applying the rotation/flip via matrix
  // transforms.  For orientation 1 we export the stitched canvas directly.
  let exportCanvas: OffscreenCanvas = stitchCanvas
  if (orientation !== 1) {
    const { width: outW, height: outH } = orientedOutputSize(
      grid.outputWidth,
      grid.outputHeight,
      orientation,
    )
    exportCanvas = new OffscreenCanvas(outW, outH)
    const exportCtx = exportCanvas.getContext('2d')!
    applyOrientationDraw(
      exportCtx,
      stitchCanvas,
      orientation,
      grid.outputWidth,
      grid.outputHeight,
    )
  }
  //convertToBlob 主线程有时候会卡一下
  const blob = await exportCanvas.convertToBlob({ type: 'image/png' })
  //const blob = await exportCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.5 })
  //console.debug("end convertToBlob")
  return URL.createObjectURL(blob)
}

/**
 * Decodes all HEVC-coded samples from an animated HEIC sequence.
 * Returns an array of ImageBitmaps (ready for ctx.drawImage) paired with
 * their intended display duration derived from the stts box.
 */
export async function decodeHevcFrames(
  samples: AnimationSample[],
  hvcC: HvcCInfo,
): Promise<Array<{ url: string; durationMs: number }>> {
  const chunks = samples.map((s) => ({
    type: isKeyFrame(s.data, hvcC.naluLengthSize) ? ('key' as const) : ('delta' as const),
    data: s.data,
  }))

  const videoFrames = await decodeChunks(chunks, hvcC)

  return Promise.all(
    videoFrames.map(async (frame, i) => {
      const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(frame, 0, 0)
      frame.close()
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const url = URL.createObjectURL(blob)
      return { url, durationMs: samples[i]?.durationMs ?? 1000 / 24 }
    }),
  )
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Inspects the first NAL unit in an HVCC-formatted sample to determine whether
 * it is an IRAP (Intra Random Access Picture) frame.
 *
 * HEVC NAL unit header (2 bytes):
 *   Byte 0: forbidden_zero_bit(1) | nal_unit_type(6) | nuh_layer_id_high3(1)
 *
 * IRAP NAL types are 16–23 (IDR_W_RADL, IDR_N_LP, BLA_W_LP, CRA_NUT, etc.)
 */
function isKeyFrame(data: Uint8Array, naluLengthSize: number): boolean {
  if (data.length < naluLengthSize + 2) return false
  const nalType = (data[naluLengthSize] >> 1) & 0x3f
  return nalType >= 16 && nalType <= 23
}

/**
 * Feeds an array of encoded chunks into a VideoDecoder and resolves with
 * the collected VideoFrames in decode order.
 *
 * The codec string and description come from the file's hvcC box; the
 * description enables hvc1-style parameter-set-out-of-band decoding so the
 * raw sample data does not need to carry VPS/SPS/PPS NAL units.
 */
function decodeChunks(
  chunks: Array<{ type: 'key' | 'delta'; data: Uint8Array }>,
  hvcC: HvcCInfo,
): Promise<VideoFrame[]> {
  return new Promise((resolve, reject) => {
    const collected: VideoFrame[] = []
    /*
    //only for debug
    let startTime = null;
    let frameCount = 0;
    */
    const decoder = new VideoDecoder({
      output: (frame) => {
        /*
        // only for debug
        if (startTime == null) {
          startTime = performance.now();
        } else {
          const elapsed = (performance.now() - startTime) / 1000;
          const fps = ++frameCount / elapsed;
          console.debug("render", `${fps.toFixed(0)} fps`);
        };
        */
        collected.push(frame)},
      error: reject,
    })

    decoder.configure({
      codec: hvcC.codecString,
      description: hvcC.description,
      hardwareAcceleration: 'prefer-hardware',
    })

    // Enqueue all chunks before awaiting flush so the decoder can pipeline them
    chunks.forEach(({ type, data }, i) => {
      decoder.decode(
        new EncodedVideoChunk({
          type,
          // Timestamps in microseconds; 33 333 µs ≈ 30 fps — used only for
          // decoder ordering, not for playback timing (we use durationMs for that)
          timestamp: i * 33333,
          data,
        }),
      )
    })

    decoder
      .flush()
      .then(() => {
        decoder.close()
        resolve(collected)
      })
      .catch((err) => {
        try { decoder.close() } catch { /* already closed */ }
        reject(err)
      })
  })
}
