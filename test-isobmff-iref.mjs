/**
 * test-isobmff-iref.mjs
 *
 * 深入分析 iref 结构，找出 primary item 引用的子 item，
 * 以及每个子 item 对应的 hvcC 属性
 */

import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { createRequire } from 'module'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

// helpers
function readBox(view, offset) {
  if (offset + 8 > view.byteLength) return null
  let size = view.getUint32(offset, false)
  const type = String.fromCharCode(
    view.getUint8(offset+4), view.getUint8(offset+5),
    view.getUint8(offset+6), view.getUint8(offset+7)
  )
  let contentOffset = offset + 8
  if (size === 1) {
    size = view.getUint32(offset+8,false)*0x100000000 + view.getUint32(offset+12,false)
    contentOffset = offset + 16
  } else if (size === 0) size = view.byteLength - offset
  return { type, size, offset, contentOffset }
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
function findIn(boxes, type) { return boxes.find(b => b.type === type) ?? null }
function readStr4(view, off) {
  return String.fromCharCode(view.getUint8(off), view.getUint8(off+1), view.getUint8(off+2), view.getUint8(off+3))
}

function analyzeFile(filePath) {
  console.log('\n' + '═'.repeat(64))
  console.log(`FILE: ${filePath}`)
  console.log('═'.repeat(64))

  const nodeBuf = readFileSync(filePath)
  const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)
  const view = new DataView(ab)

  const topLevel = listChildren(view, 0, ab.byteLength)
  const metaBox = findIn(topLevel, 'meta')
  if (!metaBox) { console.log('No meta'); return }

  const metaContent = fbContent(metaBox)
  const metaEnd = metaBox.offset + metaBox.size
  const metaChildren = listChildren(view, metaContent, metaEnd)

  // pitm
  const pitmBox = findIn(metaChildren, 'pitm')
  const pitmVersion = view.getUint8(pitmBox.contentOffset)
  const primaryItemId = pitmVersion === 0
    ? view.getUint16(fbContent(pitmBox), false)
    : view.getUint32(fbContent(pitmBox), false)
  console.log(`primaryItemId = ${primaryItemId}`)

  // iinf: parse all infe entries
  const iinfBox = findIn(metaChildren, 'iinf')
  const iinfVersion = view.getUint8(iinfBox.contentOffset)
  const infeStart = fbContent(iinfBox) + (iinfVersion === 0 ? 2 : 4)
  const iinfEnd = iinfBox.offset + iinfBox.size
  const infeBoxes = listChildren(view, infeStart, iinfEnd)

  const itemTypeMap = new Map() // itemId → type string
  for (const infe of infeBoxes) {
    if (infe.type !== 'infe') continue
    const infeVer = view.getUint8(infe.contentOffset)
    if (infeVer < 2) continue
    const fc = fbContent(infe)
    const itemId = infeVer === 2 ? view.getUint16(fc, false) : view.getUint32(fc, false)
    const idSize = infeVer === 2 ? 2 : 4
    const typeOff = fc + idSize + 2
    if (typeOff + 4 <= view.byteLength) {
      itemTypeMap.set(itemId, readStr4(view, typeOff))
    }
  }
  console.log(`primary item type: ${itemTypeMap.get(primaryItemId)}`)

  // iref: parse all reference boxes
  const irefBox = findIn(metaChildren, 'iref')
  if (irefBox) {
    const irefVersion = view.getUint8(irefBox.contentOffset)
    const irefContent = fbContent(irefBox)
    const irefEnd = irefBox.offset + irefBox.size
    console.log(`\niref (version=${irefVersion}):`)

    let pos = irefContent
    while (pos + 8 <= irefEnd) {
      // Each iref child is a SingleItemTypeReferenceBox (or ...Large)
      let refSize = view.getUint32(pos, false)
      const refType = readStr4(view, pos + 4)
      let contentPos = pos + 8
      if (refSize === 1) {
        refSize = view.getUint32(pos+8,false)*0x100000000 + view.getUint32(pos+12,false)
        contentPos = pos + 16
      }
      const fromItemId = irefVersion === 0
        ? view.getUint16(contentPos, false)
        : view.getUint32(contentPos, false)
      contentPos += irefVersion === 0 ? 2 : 4
      const refCount = view.getUint16(contentPos, false)
      contentPos += 2
      const toIds = []
      for (let i = 0; i < refCount; i++) {
        toIds.push(irefVersion === 0
          ? view.getUint16(contentPos + i*2, false)
          : view.getUint32(contentPos + i*4, false))
      }
      if (fromItemId === primaryItemId || toIds.includes(primaryItemId)) {
        console.log(`  ${refType}: from=${fromItemId}(${itemTypeMap.get(fromItemId)}) → [${toIds.map(id=>`${id}(${itemTypeMap.get(id)})`).join(', ')}]`)
      }
      pos += refSize
    }
  }

  // ipco: list all props and which item each belongs to (via ipma)
  const iprpBox = findIn(metaChildren, 'iprp')
  const iprpEnd = iprpBox.offset + iprpBox.size
  const iprpChildren = listChildren(view, iprpBox.contentOffset, iprpEnd)
  const ipcoBox = findIn(iprpChildren, 'ipco')
  const ipmaBox = findIn(iprpChildren, 'ipma')

  const ipcoEnd = ipcoBox.offset + ipcoBox.size
  const propBoxes = listChildren(view, ipcoBox.contentOffset, ipcoEnd)

  // Build map: itemId → prop indices
  const ipmaVersion = view.getUint8(ipmaBox.contentOffset)
  const ipmaFlags = view.getUint32(ipmaBox.contentOffset, false) & 0xffffff
  const use16BitIdx = (ipmaFlags & 1) !== 0
  let ipmaPos = fbContent(ipmaBox)
  const ipmaEntryCount = view.getUint32(ipmaPos, false)
  ipmaPos += 4

  const itemProps = new Map() // itemId → Set<propIndex>
  for (let i = 0; i < ipmaEntryCount; i++) {
    const assocItemId = ipmaVersion === 0
      ? view.getUint16(ipmaPos, false) : view.getUint32(ipmaPos, false)
    ipmaPos += ipmaVersion === 0 ? 2 : 4
    const assocCount = view.getUint8(ipmaPos++)
    if (!itemProps.has(assocItemId)) itemProps.set(assocItemId, new Set())
    for (let j = 0; j < assocCount; j++) {
      let idx
      if (use16BitIdx) { idx = view.getUint16(ipmaPos, false) & 0x7fff; ipmaPos += 2 }
      else { idx = view.getUint8(ipmaPos++) & 0x7f }
      itemProps.get(assocItemId).add(idx)
    }
  }

  // Show items that have hvcC
  console.log('\nItems with hvcC property:')
  for (const [itemId, indices] of itemProps) {
    for (const pi of indices) {
      const prop = propBoxes[pi - 1]
      if (prop && prop.type === 'hvcC') {
        console.log(`  itemId=${itemId}(${itemTypeMap.get(itemId)}) has hvcC at prop[${pi}]`)
        // also show what ispe is associated with it
        const itemIndices = [...itemProps.get(itemId)]
        const ispeIndices = itemIndices.filter(i2 => propBoxes[i2-1]?.type === 'ispe')
        console.log(`    other props: [${itemIndices.map(i2=>`${i2}:${propBoxes[i2-1]?.type}`).join(', ')}]`)
      }
    }
  }
}

const files = process.argv.slice(2)
for (const f of files) analyzeFile(f)
