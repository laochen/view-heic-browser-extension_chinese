import * as heicDecode from "heic-decode"
import { CONFIG } from "./constants"
import type { ConversionOptions } from "./types"

// ─── Types for heic-decode fallback ──────────────────────────────────────────

interface DecodedFrameData {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

interface HeicDecodeFrame {
  width: number
  height: number
  decode: () => Promise<DecodedFrameData>
}
type HeicDecodeFrameList = HeicDecodeFrame[] & { dispose?: () => void }

// ─── Worker Logic ─────────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { id, buffer, options, type } = e.data
  const byteArray = new Uint8Array(buffer)
  console.debug(`[Worker] 开始任务 ID: ${id}, 类型: ${type}`)

  try {
    if (type === "animated") {
      const animatedResult = await processAnimated(byteArray, options)
      if (animatedResult) {
        self.postMessage({
          id,
          success: true,
          type: "animated",
          frames: animatedResult.frames,
          width: animatedResult.width,
          height: animatedResult.height,
        })
        return
      }
      // 如果动图处理返回 null (例如解析失败)，则向下穿透 fallback 到静态首帧处理
      console.warn(`[Worker] 动图处理回退，尝试静态帧渲染 ID: ${id}`)
    }

    const url = await processSingleFrame(byteArray, options)
    if (!url) {
      throw new Error("Worker HEIC帧解码失败")
    }
    self.postMessage({ id, success: true, type: "single", url })
  } catch (error: any) {
    self.postMessage({ id, success: false, error: error.message || String(error) })
  }
}

// ─── Core Processors ─────────────────────────────────────────────────────────

async function processSingleFrame(buffer: Uint8Array, options: ConversionOptions): Promise<string | null> {
  try {
    const decodeOne: (opts: { buffer: Uint8Array }) => Promise<DecodedFrameData> =
      (heicDecode as any).default ?? (heicDecode as any)

    if (typeof decodeOne !== "function") throw new Error("heic-decode.default not available")

    const frame: DecodedFrameData = await decodeOne({ buffer })
    if (!frame) throw new Error("No frame decoded")

    // 确保传递给 ImageData 的是严格的 Uint8ClampedArray
    const clampedData = frame.data instanceof Uint8ClampedArray 
      ? frame.data 
      : new Uint8ClampedArray(frame.data.buffer || frame.data)
      
    const imageData = new ImageData(clampedData, frame.width, frame.height)
    const canvas = new OffscreenCanvas(frame.width, frame.height)
    const ctx = canvas.getContext("2d", { willReadFrequently: false })!
    
    ctx.putImageData(imageData, 0, 0)

    const blob = await canvas.convertToBlob({ type: "image/png" })

    return URL.createObjectURL(blob)
  } catch (err) {
    console.error("⚠️ Worker HEIC 静态帧解码失败:", err)
    return null
  }
}

async function processAnimated(
  buffer: Uint8Array,
  options: ConversionOptions
): Promise<{ frames: Array<{ url: string; durationMs: number }>; width: number; height: number } | null> {
  let urlFrames: Array<{ url: string; durationMs: number }> = []
  let frames: HeicDecodeFrameList | null = null

  try {
    const decodeAll: (opts: { buffer: Uint8Array }) => Promise<HeicDecodeFrameList> =
      (heicDecode as any).default?.all ?? (heicDecode as any).all

    if (typeof decodeAll !== "function") throw new Error("heic-decode.all not available")

    frames = await decodeAll({ buffer })

    if (!frames || frames.length === 0) throw new Error("No frames decoded")
    if (frames.length === 1) {
      frames.dispose?.()
      return null // 交给单帧处理
    }

    const { width, height } = frames[0]
    
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext("2d", { willReadFrequently: false })!

    for (let i = 0; i < frames.length; i++) {
      const rawFrame = await frames[i].decode()
      
      // 如果某一帧尺寸突变，动态调整 Canvas 尺寸
      if (canvas.width !== rawFrame.width || canvas.height !== rawFrame.height) {
        canvas.width = rawFrame.width
        canvas.height = rawFrame.height
      }

      const clampedData = rawFrame.data instanceof Uint8ClampedArray 
        ? rawFrame.data 
        : new Uint8ClampedArray(rawFrame.data.buffer || rawFrame.data)
        
      const imageData = new ImageData(clampedData, rawFrame.width, rawFrame.height)
      ctx.putImageData(imageData, 0, 0)
      
      const blob = await canvas.convertToBlob({ type: "image/png" })
      urlFrames.push({
        url: URL.createObjectURL(blob),
        durationMs: Math.round(1000 / CONFIG.ANIMATION_FPS),
      })
    }

    frames.dispose?.()
    return { frames: urlFrames, width, height }

  } catch (err) {
    console.warn("⚠️ Worker 动画 HEIC 帧解码失败，清理残留 URL 并回退到静态首帧:", err)
    
    // 把已经创建的 Blob URL 销毁，否则泄漏
    for (const f of urlFrames) {
      URL.revokeObjectURL(f.url)
    }
    frames?.dispose?.()
    return null
  }
}