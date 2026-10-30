import { defineConfig } from "wxt"

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: "View HEIC",
    description: "View HEIC as Normal Image in Your Browser",
    // 声明 worker 脚本为可访问资源，使 content script 中
    // chrome.runtime.getURL() 能正确加载 Worker 文件
    web_accessible_resources: [
      {
        resources: ["assets/*.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
  runner: {
    disabled: true,
  },
})
