/**
 * utils/heic-viewer.ts
 *
 * Framework-agnostic HEIC auto-conversion module.
 *
 * Shared by two entry points:
 *  - entrypoints/content.ts   (WXT Chrome extension content script)
 *  - entrypoints/heic-viewer.lib.ts (standalone browser script bundle)
 *
 * Neither depends on `defineContentScript` or any WXT global, so it can run in
 * a plain browser via a `<script>` tag.
 */

import { debounce } from "lodash-es"
import { CONFIG, SELECTORS } from "./constants"
import { HEICConverter } from "./heic-converter"

/** Lifecycle handle returned by startHEICViewer for teardown/manual control. */
export interface HEICViewerHandle {
  converter: HEICConverter
  /** Stops the MutationObserver and revokes blob URLs. Safe to call once. */
  stop: () => void
}

/**
 * Boots the auto-conversion: injects styles, scans existing images, and starts
 * watching the DOM for images added/changed later.  Returns a handle whose
 * `stop()` detaches the observer and frees resources.
 */
export function startHEICViewer(): HEICViewerHandle {
  console.log("🖼️ View HEIC Loaded")

  injectStyles()

  const converter = new HEICConverter()

  // Initial sweep of the page, then live DOM observation for SPA/lazy images.
  void processHEICImages(converter)
  const observer = observeHEICImages(converter)

  // Best-effort cleanup on page teardown.
  const cleanup = () => {
    observer.disconnect()
    converter.cleanup()
  }
  window.addEventListener("beforeunload", cleanup, { once: true })

  return {
    converter,
    stop: cleanup,
  }
}

/**
 * Injects the processing/converted/error styles once per document.  Idempotent:
 * a second call is a no-op (guarded by a data attribute on the <style> node).
 */
export function injectStyles(): void {
  const STYLE_ID = "view-heic-styles"
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    /* HEIC图片处理状态样式 */
    .heic-processing {
      position: relative;
      opacity: 0.7;
      transition: opacity 0.3s ease;
    }

    .heic-processing::after {
      content: "🔄 转换中...";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 1000;
      pointer-events: none;
    }

    .heic-converted {
      opacity: 1;
      transition: opacity 0.3s ease;
    }

    .heic-error {
      position: relative;
      border: 2px dashed #ff6b6b !important;
      opacity: 0.8;
      filter: grayscale(50%);
      cursor: pointer;
    }

    .heic-error::after {
      content: "❌ 转换失败 - 点击查看原图";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 107, 107, 0.9);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 1000;
      pointer-events: none;
    }

    .heic-error:hover {
      opacity: 1;
      filter: grayscale(0%);
    }
  `
  document.head.appendChild(style)
}

/**
 * Processes every HEIC <img> currently in the document with concurrency
 * throttling handled by the converter.
 */
export async function processHEICImages(converter: HEICConverter): Promise<void> {
  const images = document.querySelectorAll<HTMLImageElement>(SELECTORS.HEIC_IMAGES)

  if (images.length === 0) {
    return
  }

  console.log(`📷 发现 ${images.length} 张HEIC图片，开始转换...`)

  const results = await converter.convertAllImages(images)

  const successCount = results.filter((r) => r.success).length
  const failureCount = results.length - successCount

  console.log(`✅ 转换完成: ${successCount} 成功, ${failureCount} 失败`)

  if (failureCount > 0) {
    console.warn("⚠️ 部分图片转换失败，可能是由于CORS限制或格式问题")
  }
}

/**
 * Watches document.body for <img> nodes that are added or have their `src`
 * changed to a HEIC URL, and re-runs conversion (debounced).
 *
 * Returns the active MutationObserver so callers can disconnect it on teardown.
 */
export function observeHEICImages(converter: HEICConverter): MutationObserver {
  const debouncedProcess = debounce(
    () => {
      processHEICImages(converter)
    },
    CONFIG.DEBOUNCE_DELAY,
    {
      trailing: true,
      leading: false,
    }
  )

  const observer = new MutationObserver((mutations) => {
    let hasNewImages = false

    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.attributeName === "src") {
        // 检查img的src属性是否变化为新的HEIC图片
        const target = mutation.target
        if (target.nodeType === Node.ELEMENT_NODE && (target as Element).tagName === "IMG") {
          const img = target as HTMLImageElement
          //console.log("🔄 检测到img src变化:", img.src)
          if (!img.src.startsWith("blob:")) {
            // src已变为普通URL，重置processed状态确保解码正常进行
            converter.resetImageProcessed(img)
            if(isHEICImage(img)){
              //console.log("🔄 检测到img src变化为HEIC图片，重置处理状态:", img.src)
              hasNewImages = true
            }
          }
        }
      }

      if (hasNewImages) break
    }

    if (hasNewImages) {
      //console.log("🔄 检测到新的HEIC图片，准备处理...")
      debouncedProcess()
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  })

  return observer
}

/**
 * Heuristic check for HEIC-format images based on src/alt file extension.
 * Used by the observer to decide whether to (re-)convert an element.
 */
export function isHEICImage(img: HTMLImageElement): boolean {
  const src = img.src.toLowerCase()
  const alt = img.alt.toLowerCase()
  return src.endsWith(".heic") || src.endsWith(".heif") || alt.endsWith(".heic") || alt.endsWith(".heif")
}
