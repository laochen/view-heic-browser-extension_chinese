import { startHEICViewer } from "../utils/heic-viewer"

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_end",
  async main() {
    // Framework-agnostic boot: inject styles, scan existing images, observe DOM.
    // Shared with entrypoints/heic-viewer.lib.ts (standalone browser script).
    startHEICViewer()
  },
})
