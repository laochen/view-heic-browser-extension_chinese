import { CONFIG } from "./constants"
import type { ConversionOptions } from "./types"
import { extractStaticFrame, extractAnimationSamples } from "./isobmff"
import { getExifOrientation } from "./exif"
import { decodeHevcFrameToURL, decodeHevcFrames, decodeGridTilesToURL } from "./webcodecs-hevc"

// ─── Worker Logic ─────────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { id, buffer, options, type } = e.data

  try {
    if (type === "animated") {
      const animatedResult = await processAnimated(buffer, options)
      if (animatedResult) {
        self.postMessage(
          {
            id,
            success: true,
            type: "animated",
            frames: animatedResult.frames,
            width: animatedResult.width,
            height: animatedResult.height,
          }
        )
        return
      }
    }

    const url = await processSingleFrame(buffer, options)
    self.postMessage({ id, success: true, type: "single", url })
  } catch (error: any) {
    self.postMessage({ id, success: false, error: error.message || String(error) })
  }
}

async function processSingleFrame(buffer: ArrayBuffer, options: ConversionOptions): Promise<string> {
  const frameData = extractStaticFrame(buffer)
  if (frameData) {
    const orientation = frameData.exifData ? getExifOrientation(frameData.exifData) : 1
    if (frameData.grid && frameData.tiles && frameData.tiles.length > 0) {
      console.debug(
        `🎬 Worker WebCodecs HEVC: stitching ${frameData.tiles.length} grid tiles` +
        ` (${frameData.grid.columns}×${frameData.grid.rows}, output ${frameData.grid.outputWidth}×${frameData.grid.outputHeight})` +
        ` orientation=${orientation}`
      )
      return await decodeGridTilesToURL(frameData.tiles, frameData.grid, orientation)
    } else {
      console.debug(`🎬 Worker WebCodecs HEVC: decoding static HEIC frame, orientation=${orientation}`)
      return await decodeHevcFrameToURL(frameData.sampleData, frameData.hvcC, orientation)
    }
  }
  throw new Error("Failed to extract static frame from HEIC")
}

async function processAnimated(
  buffer: ArrayBuffer,
  options: ConversionOptions
): Promise<{ frames: Array<{ url: string; durationMs: number }>; width: number; height: number } | null> {
  const animData = extractAnimationSamples(buffer)
  if (animData) {
    if (animData.samples.length <= 1) {
      return null // Single-frame sequence -> fall through
    }
    console.debug(`🎬 Worker WebCodecs HEVC: decoding ${animData.samples.length} animation frames`)
    const urlFrames = await decodeHevcFrames(animData.samples, animData.hvcC)
    return { frames: urlFrames, width: animData.width, height: animData.height }
  }
  return null
}
