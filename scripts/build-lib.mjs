import esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

async function build() {
  const watch = process.argv.includes("--watch");
  
  const workerOptions = {
    entryPoints: [
      path.join(rootDir, "utils/heic-worker-hard.ts"),
      path.join(rootDir, "utils/heic-worker-soft.ts"),
    ],
    bundle: true,
    minify: !watch,
    format: "iife",
    outdir: path.join(rootDir, "dist"),
  };

  if (watch) {
    const workerCtx = await esbuild.context(workerOptions);
    await workerCtx.watch();
    console.log("Watching workers...");
  } else {
    await esbuild.build(workerOptions);
  }

  const resolveWorkerUrlPlugin = {
    name: "resolve-worker-url",
    setup(build) {
      build.onResolve({ filter: /\?worker&url$/ }, args => {
        return { path: args.path, namespace: 'worker-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'worker-url' }, args => {
        const filename = args.path.replace("?worker&url", "").replace(".ts", ".js");
        return { contents: `export default "${filename}";`, loader: 'js' };
      });
    },
  };

  const libOptions = {
    entryPoints: [path.join(rootDir, "lib/heic-viewer.lib.ts")],
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    minify: !watch,
    sourcemap: false,
    outfile: path.join(rootDir, "dist/view-heic.js"),
    plugins: [resolveWorkerUrlPlugin],
    logOverride: {
      "empty-import-meta": "silent",
    },
  };

  if (watch) {
    const libCtx = await esbuild.context(libOptions);
    await libCtx.watch();
    console.log("Watching lib...");
  } else {
    await esbuild.build(libOptions);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
