/**
 * test-isobmff-debug.mjs
 *
 * 带详细调试输出的 isobmff 测试脚本
 */

import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { createRequire } from 'module'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ── 1. Transpile isobmff.ts ──────────────────────────────────────────────────
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
const isobmff = require(outFile)

// ── 2. Low-level debug parser ─────────────────────────────────────────────────

function readBox(view, offset) {
  if (offset + 8 > view.byteLength) return null
  let size = view.getUint32(offset, false)
  const type = String.fromCharCode(
    view.getUint8(offset + 4), view.getUint8(offset + 5),
    view.getUint8(offset + 6), view.getUint8(offset + 7),
  )
  let contentOffset = offset + 8
  if (size === 1) {
    size = view.getUint32(offset + 8, false) * 0x100000000 + view.getUint32(offset + 12, false)
    contentOffset = offset + 16
  } else if (size === 0) {
    size = view.byteLength - offset
  }
  return { type, size, offset, contentOffset }
}

function listTopLevel(view) {
  const boxes = []
  let offset = 0
  while (offset + 8 <= view.byteLength) {
    const box = readBox(view, offset)
    if (!box || box.size < 8) break
    boxes.push(box)
    offset += box.size
  }
  return boxes
}

function listChildren(view, start, end) {
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    const box = readBox(view, offset)
    if (!box || box.size < 8) break
    boxes.push(box)
    offset += box.size
  }
  return boxes
}

function fbContent(box) { return box.contentOffset + 4 }

// ── 3. Debug a single file ────────────────────────────────────────────────────

function debugFile(filePath) {
  console.log('\n' + '═'.repeat(64))
  console.log(`FILE: ${filePath}`)
  console.log('═'.repeat(64))

  // IMPORTANT: copy to a fresh ArrayBuffer to avoid SharedArrayBuffer / offset issues
  const nodeBuf = readFileSync(filePath)
  const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)
  const view = new DataView(ab)
  const fileEnd = ab.byteLength
  console.log(`  File size: ${fileEnd.toLocaleString()} bytes`)

  // Top-level boxes
  const topLevel = listTopLevel(view)
  console.log(`  Top-level boxes: ${topLevel.map(b => `${b.type}(${b.size})`).join(', ')}`)

  // ftyp brand
  const ftypBox = topLevel.find(b => b.type === 'ftyp')
  if (ftypBox) {
    const brand = String.fromCharCode(
      view.getUint8(ftypBox.contentOffset), view.getUint8(ftypBox.contentOffset+1),
      view.getUint8(ftypBox.contentOffset+2), view.getUint8(ftypBox.contentOffset+3),
    )
    console.log(`  ftyp brand: "${brand}"`)
  }

  // meta box
  const metaBox = topLevel.find(b => b.type === 'meta')
  if (!metaBox) {
    console.log('  ✗ No top-level meta box found')
    // Try nested in moov?
    const moovBox = topLevel.find(b => b.type === 'moov')
    if (moovBox) {
      console.log('  Found moov – this may be animated HEIC')
    }
    return
  }
  const metaContent = fbContent(metaBox)
  const metaEnd = metaBox.offset + metaBox.size
  const metaChildren = listChildren(view, metaContent, metaEnd)
  console.log(`  meta children: ${metaChildren.map(b => `${b.type}(${b.size})`).join(', ')}`)

  // pitm
  const pitmBox = metaChildren.find(b => b.type === 'pitm')
  if (!pitmBox) { console.log('  ✗ No pitm'); return }
  const pitmVersion = view.getUint8(pitmBox.contentOffset)
  const primaryItemId = pitmVersion === 0
    ? view.getUint16(fbContent(pitmBox), false)
    : view.getUint32(fbContent(pitmBox), false)
  console.log(`  pitm: version=${pitmVersion}, primaryItemId=${primaryItemId}`)

  // iinf
  const iinfBox = metaChildren.find(b => b.type === 'iinf')
  if (!iinfBox) { console.log('  ✗ No iinf'); return }
  const iinfVersion = view.getUint8(iinfBox.contentOffset)
  const infeStart = fbContent(iinfBox) + (iinfVersion === 0 ? 2 : 4)
  const iinfEnd = iinfBox.offset + iinfBox.size
  const infeBoxes = listChildren(view, infeStart, iinfEnd)
  console.log(`  iinf: ${infeBoxes.length} infe entries`)

  // iloc
  const ilocBox = metaChildren.find(b => b.type === 'iloc')
  if (!ilocBox) { console.log('  ✗ No iloc'); return }
  console.log(`  iloc: found`)

  // iprp → ipco + ipma
  const iprpBox = metaChildren.find(b => b.type === 'iprp')
  if (!iprpBox) { console.log('  ✗ No iprp'); return }
  const iprpEnd = iprpBox.offset + iprpBox.size
  const iprpChildren = listChildren(view, iprpBox.contentOffset, iprpEnd)
  console.log(`  iprp children: ${iprpChildren.map(b => `${b.type}(${b.size})`).join(', ')}`)

  const ipcoBox = iprpChildren.find(b => b.type === 'ipco')
  const ipmaBox = iprpChildren.find(b => b.type === 'ipma')
  if (!ipcoBox) { console.log('  ✗ No ipco'); return }
  if (!ipmaBox) { console.log('  ✗ No ipma'); return }

  // List all ipco props
  const ipcoEnd = ipcoBox.offset + ipcoBox.size
  const propBoxes = listChildren(view, ipcoBox.contentOffset, ipcoEnd)
  console.log(`  ipco props (${propBoxes.length} total):`)
  propBoxes.forEach((p, i) => console.log(`    [${i+1}] type=${p.type} size=${p.size}`))

  // Parse ipma – find all entries for primaryItemId
  const ipmaVersion = view.getUint8(ipmaBox.contentOffset)
  const ipmaFlags = view.getUint32(ipmaBox.contentOffset, false) & 0xffffff
  const use16BitIdx = (ipmaFlags & 1) !== 0
  let ipmaPos = fbContent(ipmaBox)
  const ipmaEntryCount = view.getUint32(ipmaPos, false)
  ipmaPos += 4
  console.log(`  ipma: version=${ipmaVersion}, flags=0x${ipmaFlags.toString(16)}, use16BitIdx=${use16BitIdx}, entryCount=${ipmaEntryCount}`)

  const primaryPropIndices = new Set()
  for (let i = 0; i < ipmaEntryCount; i++) {
    const assocItemId = ipmaVersion === 0 ? view.getUint16(ipmaPos, false) : view.getUint32(ipmaPos, false)
    ipmaPos += ipmaVersion === 0 ? 2 : 4
    const assocCount = view.getUint8(ipmaPos++)
    const indices = []
    for (let j = 0; j < assocCount; j++) {
      let idx
      if (use16BitIdx) { idx = view.getUint16(ipmaPos, false) & 0x7fff; ipmaPos += 2 }
      else { idx = view.getUint8(ipmaPos++) & 0x7f }
      indices.push(idx)
      if (assocItemId === primaryItemId) primaryPropIndices.add(idx)
    }
    if (assocItemId === primaryItemId) {
      console.log(`  ipma entry ${i}: itemId=${assocItemId} (PRIMARY) → indices=[${indices.join(',')}]`)
    }
  }
  console.log(`  primaryPropIndices: [${[...primaryPropIndices].join(',')}]`)

  // Which props does primary item have?
  for (const pi of primaryPropIndices) {
    const prop = propBoxes[pi - 1]
    console.log(`    prop[${pi}] = ${prop ? prop.type : '(out of range)'}`)
  }

  // Now call the actual function
  console.log('\n  --- Calling extractStaticFrame ---')
  const result = isobmff.extractStaticFrame(ab)
  if (result) {
    console.log(`  ✓ SUCCESS`)
    console.log(`    codec: ${result.hvcC.codecString}`)
    console.log(`    size: ${result.width}×${result.height}`)
    console.log(`    sampleData: ${result.sampleData.byteLength} bytes`)
  } else {
    console.log('  ✗ extractStaticFrame returned null')
  }
}

// ── 4. Run ────────────────────────────────────────────────────────────────────
const files = process.argv.slice(2)
for (const f of files) debugFile(f)
