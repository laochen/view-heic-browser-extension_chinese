import { CONFIG, DATA_ATTRIBUTES, ERROR_MESSAGES, ERROR_TYPES } from "./constants"
import type { ConversionError, ConversionOptions, ConversionResult } from "./types"
import { isHEVCSupported } from "./webcodecs-hevc"

import hardWorkerUrl from "./heic-worker-hard.ts?worker&url"
import softWorkerUrl from "./heic-worker-soft.ts?worker&url"

// ─── Magic-bytes helpers ────────────────────────────────────────────────────

const HEIC_BRANDS_SINGLE = new Set(["mif1", "heic", "heix"])
const HEIC_BRANDS_SEQUENCE = new Set(["msf1", "hevc", "hevx"])

function getHeicBrand(buffer: ArrayBuffer): string {
  if (buffer.byteLength < 12) return ""
  const bytes = new Uint8Array(buffer, 8, 4)
  return String.fromCharCode(...bytes).replace(/\0/g, " ").trim()
}

function isHeicBuffer(buffer: ArrayBuffer): boolean {
  const brand = getHeicBrand(buffer)
  return HEIC_BRANDS_SINGLE.has(brand) || HEIC_BRANDS_SEQUENCE.has(brand)
}

function isAnimatedHeicBuffer(buffer: ArrayBuffer): boolean {
  return HEIC_BRANDS_SEQUENCE.has(getHeicBrand(buffer))
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CacheEntry =
  | { type: "single"; url: string; refCount: number } // 优化: 增加引用计数
  | { type: "animated"; frames: Array<{ url: string; durationMs: number }>; refCount: number }

// ─── Converter ──────────────────────────────────────────────────────────────

export class HEICConverter {
  private processedImages = new WeakSet<HTMLImageElement>()
  private processingQueue = new Map<HTMLImageElement, Promise<ConversionResult>>()
  private urlCache = new Map<string, CacheEntry>()
  
  // 存储 requestAnimationFrame 的 ID
  private animationTimers = new Map<HTMLImageElement, number>() 
  
  private workerPromise: Promise<Worker>
  private workerTaskId = 0
  private workerCallbacks = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>()

  constructor() {
    this.workerPromise = this.initWorker()
  }

  private async initWorker(): Promise<Worker> {
    try {
      const supported = await isHEVCSupported()
      const workerUrl = supported ? hardWorkerUrl : softWorkerUrl
      
      let worker: Worker
      // Chrome 插件环境下需要通过 Blob URL 来绕过跨域安全限制 (SecurityError)
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        const resolvedUrl = chrome.runtime.getURL(workerUrl)
        const response = await fetch(resolvedUrl)
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        worker = new Worker(blobUrl, { type: "module" })
        URL.revokeObjectURL(blobUrl)
      } else {
        worker = new Worker(workerUrl, { type: "module" })
      }

      // 处理正常的消息通信
      worker.onmessage = (e) => {
        const { id, success, error, type, url, frames, width, height } = e.data
        const callbacks = this.workerCallbacks.get(id)
        if (callbacks) {
          if (success) {
            callbacks.resolve({ type, url, frames, width, height })
          } else {
            callbacks.reject(new Error(error))
          }
          this.workerCallbacks.delete(id)
        }
      }

      // 捕获 Worker 级别的异步异常 (如: 脚本 404 加载失败、Worker 崩溃)
      worker.onerror = (errorEvent: ErrorEvent) => {
        console.error("🔴 HEIC Worker 发生异常:", errorEvent.message || errorEvent)
        
        // 必须清空并拒绝所有正在排队的任务，否则主线程这些 Promise 会永远 pending
        const errorMessage = errorEvent.message || "Worker 加载失败或发生致命错误"
        this.workerCallbacks.forEach((callbacks, id) => {
          callbacks.reject(new Error(errorMessage))
        })
        this.workerCallbacks.clear()

        this.workerPromise = Promise.reject(new Error("Worker crashed"));
      }

      // 捕获 Worker 内部 Promise 导致的 unhandledrejection
      // 注意：并不是所有浏览器都完美支持 Worker 内部冒泡出的 unhandledrejection
      worker.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
        console.warn("🟠 HEIC Worker 未捕获的 Promise 拒绝:", event.reason)
      })

      return worker

    } catch (err: any) {
      // 捕获同步异常 (如: 浏览器安全策略拦截、CSP 限制等)
      console.error("🔴 HEIC Worker 同步初始化失败:", err)
      throw new Error(`Worker 初始化失败: ${err.message || "未知错误"}`)
    }
  }


  // ── LRU Cache & Key helpers ─────────────────────────────────────────────

  private getCacheKey(src: string): string {

    // 匹配从开头一直到 .heic 或 .heif 为止的部分（忽略大小写）
    const match = src.match(/^.*?\.(?:heic|heif)/i)
    
    // 如果匹配成功，返回截断后的部分
    // 如果没匹配到（兜底），返回原始 src
    return match ? match[0] : src
  }

  private getCacheEntry(key: string): CacheEntry | undefined {
    if (!this.urlCache.has(key)) return undefined
    const entry = this.urlCache.get(key)!
    this.urlCache.delete(key)
    this.urlCache.set(key, entry)
    return entry
  }

  private setCacheEntry(key: string, entry: CacheEntry): void {
    if (this.urlCache.has(key)) {
      this.urlCache.delete(key)
    } else {
      while (this.urlCache.size >= CONFIG.MAX_CACHE_ITEMS) {
        const oldestKey = this.urlCache.keys().next().value
        if (!oldestKey) break
        
        const oldestEntry = this.urlCache.get(oldestKey)
        // 只有当引用计数为 0 时才释放 URL，防止正在显示的图片黑屏
        if (oldestEntry && oldestEntry.refCount <= 0) {
          if (oldestEntry.type === "single") {
            URL.revokeObjectURL(oldestEntry.url)
          } else {
            oldestEntry.frames.forEach((f) => URL.revokeObjectURL(f.url))
          }
        }
        this.urlCache.delete(oldestKey)
      }
    }
    this.urlCache.set(key, entry)
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private isImageProcessed(img: HTMLImageElement): boolean {
    return this.processedImages.has(img) || img.hasAttribute(DATA_ATTRIBUTES.PROCESSED)
  }

  private markImageAsProcessed(img: HTMLImageElement): void {
    this.processedImages.add(img)
    img.setAttribute(DATA_ATTRIBUTES.PROCESSED, "true")
  }

  resetImageProcessed(img: HTMLImageElement): void {
    this.processedImages.delete(img)

    // 停止动画
    if (this.animationTimers.has(img)) {
      cancelAnimationFrame(this.animationTimers.get(img)!)
      this.animationTimers.delete(img)
    }

    // 减少引用计数
    const originalSrc = img.getAttribute(DATA_ATTRIBUTES.ORIGINAL_SRC)
    if (originalSrc) {
      const cacheKey = this.getCacheKey(originalSrc)
      const cached = this.urlCache.get(cacheKey)
      if (cached) cached.refCount = Math.max(0, cached.refCount - 1)
    }

    img.removeAttribute(DATA_ATTRIBUTES.PROCESSED)
    img.removeAttribute(DATA_ATTRIBUTES.ORIGINAL_SRC)
    img.classList.remove("heic-processing", "heic-converted")
  }

  // 单独抽离带重试的网络请求，避免 Worker 解码失败时重复消耗网络流量
  private async fetchImageDataWithRetry(src: string, maxRetries: number): Promise<ArrayBuffer> {
    let lastError: any
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(src)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`, {type:ERROR_TYPES.NETWORK_ERROR})
        
        const blob = await response.blob()
        if (blob.size > CONFIG.MAX_FILE_SIZE) throw new Error(ERROR_MESSAGES.FILE_TOO_LARGE, {type:ERROR_TYPES.FILE_TOO_LARGE})

        const buffer = await blob.arrayBuffer()
        const mimeOk = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"].includes(blob.type)
        
        if (!isHeicBuffer(buffer) && !mimeOk) throw new Error(ERROR_MESSAGES.INVALID_FORMAT, {type:ERROR_TYPES.INVALID_FORMAT})
        return buffer
      } catch (error: any) {
        lastError = error
        if (error.name === "TypeError") {
          let isCrossOrigin = false
          try { isCrossOrigin = new URL(src).origin !== location.origin } catch {}
          if (isCrossOrigin) throw new Error(ERROR_MESSAGES.CORS_ERROR, {type:ERROR_TYPES.CORS_ERROR}) // CORS 错误无需重试
        }
        if (attempt < maxRetries - 1) await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
      }
    }
    throw lastError || new Error(ERROR_MESSAGES.NETWORK_ERROR, {type:ERROR_TYPES.NETWORK_ERROR})
  }

  // 使用 requestAnimationFrame 替代 setInterval，性能更好且切后台时暂停
  private setupUrlAnimation(img: HTMLImageElement, frames: Array<{ url: string; durationMs: number }>): void {
    let frameIndex = 0
    let lastDrawTime = performance.now()
    const avgDurationMs = Math.max(16, frames.reduce((sum, f) => sum + f.durationMs, 0) / frames.length)

    img.src = frames[frameIndex].url // First frame

    const animate = (time: DOMHighResTimeStamp) => {
      if (time - lastDrawTime >= avgDurationMs) {
        frameIndex = (frameIndex + 1) % frames.length
        img.src = frames[frameIndex].url
        lastDrawTime = time
      }
      this.animationTimers.set(img, requestAnimationFrame(animate))
    }
    
    this.animationTimers.set(img, requestAnimationFrame(animate))
    this.markImageAsProcessed(img)
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async convertImage(img: HTMLImageElement, options: ConversionOptions = {}): Promise<ConversionResult> {
    if (this.isImageProcessed(img)) return { success: true }
    if (this.processingQueue.has(img)) return this.processingQueue.get(img)!

    const task = this._doConvert(img, options)
    this.processingQueue.set(img, task)
    try {
      return await task
    } finally {
      this.processingQueue.delete(img)
    }
  }

  private async _doConvert(img: HTMLImageElement, options: ConversionOptions = {}): Promise<ConversionResult> {
    const originalSrc: string = img.src
    const cacheKey = this.getCacheKey(originalSrc)
    const { maxRetries = CONFIG.RETRY_ATTEMPTS } = options

    if (!img.hasAttribute(DATA_ATTRIBUTES.ORIGINAL_SRC)) {
      img.setAttribute(DATA_ATTRIBUTES.ORIGINAL_SRC, originalSrc)
    }

    const cachedEntry = this.getCacheEntry(cacheKey)
    if (cachedEntry) {
      cachedEntry.refCount++ // 增加引用计数
      if (cachedEntry.type === "single") {
        img.src = cachedEntry.url
        img.classList.add("heic-converted")
        this.markImageAsProcessed(img)
      } else if (cachedEntry.type === "animated") {
        this.setupUrlAnimation(img, cachedEntry.frames)
        img.classList.add("heic-converted")
      }
      return { success: true }
    }

    img.classList.add("heic-processing")

    try {
      // 网络请求带重试
      const buffer = await this.fetchImageDataWithRetry(originalSrc, maxRetries)
      const bufferType = isAnimatedHeicBuffer(buffer) ? "animated" : "single"
      
      const worker = await this.workerPromise
      const taskId = this.workerTaskId++
      
      // Worker 转换不应该被包在重试逻辑里，因为它是确定性任务，失败通常不是网络原因
      const workerResult = await new Promise<any>((resolve, reject) => {
        this.workerCallbacks.set(taskId, { resolve, reject })
        // [buffer] 将所有权转移给 worker，如果 worker 失败，主线程的 buffer 也会被清空
        worker.postMessage({ id: taskId, buffer, options, type: bufferType }, [buffer])
      })

      if (workerResult.type === "animated") {
        this.setCacheEntry(cacheKey, { type: "animated", frames: workerResult.frames, refCount: 1 })
        this.setupUrlAnimation(img, workerResult.frames)
      } else {
        this.setCacheEntry(cacheKey, { type: "single", url: workerResult.url, refCount: 1 })
        img.src = workerResult.url
        this.markImageAsProcessed(img)
      }

      img.classList.remove("heic-processing")
      img.classList.add("heic-converted")
      return { success: true }

    } catch (error: any) {
      return this.handleConversionError(img, error, originalSrc)
    }
  }

  // 更智能的并发控制，保持最大并发数而不是等待整批完成
  async convertAllImages(
    images: NodeListOf<HTMLImageElement> | HTMLImageElement[],
    options: ConversionOptions = {}
  ): Promise<ConversionResult[]> {
    const results: ConversionResult[] = []
    const imageArray = Array.from(images)
    
    let i = 0
    const executing = new Set<Promise<void>>()

    const enqueue = async () => {
      if (i === imageArray.length) return
      const img = imageArray[i++]
      
      const promise = this.convertImage(img, options).then(result => {
        results.push(result)
        executing.delete(promise)
      }).catch(err => {
        results.push({ success: false, error: { type: error?.type || "unknown", message: error?.message || "Error" } })
        executing.delete(promise)
      })
      
      executing.add(promise)
      
      if (executing.size >= CONFIG.MAX_CONCURRENT) {
        await Promise.race(executing)
      }
      await enqueue()
    }

    await enqueue()
    await Promise.all(executing)
    return results
  }

  cleanup(): void {
    this.urlCache.forEach((entry) => {
      if (entry.type === "single") URL.revokeObjectURL(entry.url)
      else entry.frames.forEach(f => URL.revokeObjectURL(f.url))
    })
    this.urlCache.clear()
    this.processingQueue.clear()
    this.animationTimers.forEach((id) => cancelAnimationFrame(id))
    this.animationTimers.clear()
    this.workerPromise.then(worker => worker.terminate())
  }

  private handleConversionError(img: HTMLImageElement, error: any, originalSrc: string): ConversionResult {
    img.classList.remove("heic-processing")
    img.classList.add("heic-converted")
    return { success: false, error: { type: error?.type || "unknown", message: error?.message || "Error" } }
  }
}