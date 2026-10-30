/**
 * test-isobmff.mjs
 *
 * Standalone test script that:
 *  1. Transpiles isobmff.ts on-the-fly via esbuild
 *  2. Parses each HEIC file supplied as CLI arguments
 *  3. Reports: primaryItemId, propIndices count, hvcC codec string,
 *     dimensions, and sample data size
 *
 * Usage:
 *   node test-isobmff.mjs example.heic /path/to/IMG_0449.HEIC
 */

import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { createRequire } from 'module'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ── 1. Transpile isobmff.ts via esbuild ──────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'isobmff-test-'))
const outFile = join(tmpDir, 'isobmff.cjs')

await build({
  entryPoints: ['utils/isobmff.ts'],
  bundle: false,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
})

const require = createRequire(import.meta.url)
const { extractStaticFrame, extractAnimationSamples } = require(outFile)

// ── 2. Test helper ────────────────────────────────────────────────────────────

function testFile(filePath) {
  console.log('\n' + '─'.repeat(60))
  console.log(`FILE: ${filePath}`)
  console.log('─'.repeat(60))

  let buf
  try {
    buf = readFileSync(filePath).buffer
  } catch (e) {
    console.error(`  ✗ Cannot read file: ${e.message}`)
    return false
  }

  // ── Static frame ────────────────────────────────────────────────────────────
  const staticResult = extractStaticFrame(buf)
  if (staticResult) {
    console.log('  [Static Frame] ✓')
    console.log(`    codec      : ${staticResult.hvcC.codecString}`)
    console.log(`    naluLen    : ${staticResult.hvcC.naluLengthSize}`)
    console.log(`    dimensions : ${staticResult.width} × ${staticResult.height}`)
    console.log(`    sampleData : ${staticResult.sampleData.byteLength.toLocaleString()} bytes`)
    console.log(`    descLen    : ${staticResult.hvcC.description.byteLength} bytes`)
    // Sanity checks
    const ok =
      staticResult.sampleData.byteLength > 0 &&
      staticResult.width > 0 &&
      staticResult.height > 0 &&
      staticResult.hvcC.codecString.startsWith('hvc1.')
    console.log(`    sanity     : ${ok ? '✓ PASS' : '✗ FAIL (unexpected values)'}`)
    return ok
  }

  // ── Animated fallback ────────────────────────────────────────────────────────
  const animResult = extractAnimationSamples(buf)
  if (animResult) {
    console.log('  [Animation] ✓')
    console.log(`    codec      : ${animResult.hvcC.codecString}`)
    console.log(`    dimensions : ${animResult.width} × ${animResult.height}`)
    console.log(`    frames     : ${animResult.samples.length}`)
    const ok =
      animResult.samples.length > 0 &&
      animResult.width > 0 &&
      animResult.height > 0
    console.log(`    sanity     : ${ok ? '✓ PASS' : '✗ FAIL'}`)
    return ok
  }

  console.error('  ✗ FAIL: extractStaticFrame and extractAnimationSamples both returned null')
  return false
}

// ── 3. Run tests ──────────────────────────────────────────────────────────────

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: node test-isobmff.mjs <file1.heic> [file2.heic ...]')
  process.exit(1)
}

let passed = 0
let failed = 0
for (const f of files) {
  const ok = testFile(f)
  if (ok) passed++; else failed++
}

console.log('\n' + '═'.repeat(60))
console.log(`RESULTS: ${passed} passed, ${failed} failed`)
console.log('═'.repeat(60))
process.exit(failed > 0 ? 1 : 0)
