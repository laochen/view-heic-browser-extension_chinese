/**
 * test-isobmff-final.mjs
 *
 * 最终验证测试：详细输出 grid 信息和所有 tile 的统计数据
 */

import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { createRequire } from 'module'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpDir = mkdtempSync(join(tmpdir(), 'isobmff-test-'))
const outFile = join(tmpDir, 'isobmff.cjs')
await build({ entryPoints: ['utils/isobmff.ts'], bundle: false, platform: 'node', format: 'cjs', outfile: outFile })
const require = createRequire(import.meta.url)
const { extractStaticFrame } = require(outFile)

function testFile(filePath) {
  console.log('\n' + '═'.repeat(64))
  console.log(`FILE: ${filePath}`)
  console.log('═'.repeat(64))

  const nodeBuf = readFileSync(filePath)
  const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)

  const result = extractStaticFrame(ab)
  if (!result) {
    console.error('  ✗ FAIL: returned null')
    return false
  }

  console.log(`  codec      : ${result.hvcC.codecString}`)
  console.log(`  naluLen    : ${result.hvcC.naluLengthSize}`)
  console.log(`  dimensions : ${result.width} × ${result.height}`)
  console.log(`  sampleData : ${result.sampleData.byteLength.toLocaleString()} bytes (first tile)`)

  if (result.grid) {
    const g = result.grid
    console.log(`  grid       : ${g.columns}×${g.rows} tiles, output ${g.outputWidth}×${g.outputHeight}`)
    console.log(`  tiles      : ${result.tiles.length} total`)
    const totalBytes = result.tiles.reduce((s, t) => s + t.sampleData.byteLength, 0)
    console.log(`  tile bytes : ${totalBytes.toLocaleString()} total`)
    const allHvcC = new Set(result.tiles.map(t => t.hvcC.codecString))
    console.log(`  tile codec : ${[...allHvcC].join(', ')}`)
    const tileW = result.tiles[0].width
    const tileH = result.tiles[0].height
    console.log(`  tile size  : ${tileW} × ${tileH}`)
    const expectedTiles = g.columns * g.rows
    if (result.tiles.length !== expectedTiles) {
      console.warn(`  ⚠ tile count mismatch: got ${result.tiles.length}, expected ${expectedTiles} (${g.columns}×${g.rows})`)
    }
  } else {
    console.log('  type       : simple (non-grid)')
  }

  // Sanity checks
  const ok =
    result.sampleData.byteLength > 0 &&
    result.width > 0 &&
    result.height > 0 &&
    result.hvcC.codecString.startsWith('hvc1.')
  console.log(`  sanity     : ${ok ? '✓ PASS' : '✗ FAIL'}`)
  return ok
}

const files = process.argv.slice(2)
let passed = 0, failed = 0
for (const f of files) {
  if (testFile(f)) passed++; else failed++
}
console.log(`\nRESULTS: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
