/**
 * entrypoints/heic-viewer.lib.ts
 *
 * Standalone browser-script entry point.
 *
 * Bundled (via `npm run build:lib`) into a single self-contained
 * `dist/view-heic.js` that can be loaded with a plain <script> tag on any
 * page. No framework, no globals dependency — everything (lodash-es, the
 * WASM-based heic-to/heic-decode, the WebCodecs path) is inlined.
 *
 * On load it:
 *   1. Waits for the DOM to be parseable (interactive/complete, else
 *      DOMContentLoaded).
 *   2. Calls startHEICViewer() which injects styles, scans the page, and
 *      starts a MutationObserver for lazy/SPA images.
 *
 * A handle is exposed as `window.ViewHEIC` for programmatic control.
 */

import { startHEICViewer, type HEICViewerHandle } from "../utils/heic-viewer"

// Prevent double-init when the script is somehow loaded twice on a page.
declare global {
  interface Window {
    ViewHEIC?: HEICViewerHandle
  }
}

function init(): HEICViewerHandle {
  const handle = startHEICViewer()
  window.ViewHEIC = handle
  return handle
}

if (document.readyState === "loading") {
  // DOM not yet parsed; wait so querySelectorAll can find images.
  document.addEventListener("DOMContentLoaded", () => void init(), { once: true })
} else {
  // "interactive" or "complete" — safe to scan immediately.
  init()
}

// Re-export so consumers who bundle this as a module can also import it.
export { startHEICViewer }
export type { HEICViewerHandle }
