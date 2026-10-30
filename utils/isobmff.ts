/**
 * utils/isobmff.ts
 *
 * Lightweight ISOBMFF (ISO Base Media File Format) parser for HEIC files.
 * Extracts HEVC-coded image data from both static (meta-based) and animated
 * (moov-based) HEIC containers, together with the HEVCDecoderConfigurationRecord
 * needed to configure a WebCodecs VideoDecoder.
 */

// ─── Exported Types ───────────────────────────────────────────────────────────

/** Parsed information from an hvcC (HEVCDecoderConfigurationRecord) box. */
export interface HvcCInfo {
  /** WebCodecs codec string, e.g. "hvc1.1.6.L120.90" */
  codecString: string
  /** Bytes used for HVCC NAL unit length prefix (1, 2, or 4; typically 4) */
  naluLengthSize: number
  /** Raw HEVCDecoderConfigurationRecord for VideoDecoderConfig.description */
  description: Uint8Array
}

/** Describes the grid layout of a tiled HEIC image. */
export interface GridInfo {
  /** Number of columns in the tile grid. */
  columns: number
  /** Number of rows in the tile grid. */
  rows: number
  /** Final image width in pixels (may be smaller than columns * tileWidth). */
  outputWidth: number
  /** Final image height in pixels (may be smaller than rows * tileHeight). */
  outputHeight: number
}

/** A single tile extracted from a grid-type HEIC primary item. */
export interface GridTile {
  sampleData: Uint8Array
  hvcC: HvcCInfo
  /** Tile pixel width from the tile item's ispe box. */
  width: number
  /** Tile pixel height from the tile item's ispe box. */
  height: number
}

/**
 * Extracted payload for a static (single-frame) HEIC image.
 *
 * For simple (non-grid) HEIC: `sampleData`, `hvcC`, `width`, `height` are set;
 * `grid` and `tiles` are absent.
 *
 * For grid-type HEIC (iPhone photos): `grid` and `tiles` are populated and
 * `sampleData` / `hvcC` / `width` / `height` mirror the first tile so that
 * callers that only need a quick preview still work without modification.
 */
export interface StaticFrameData {
  sampleData: Uint8Array
  hvcC: HvcCInfo
  width: number
  height: number
  /** Present only for grid-type HEIC images. */
  grid?: GridInfo
  /** All tile payloads in row-major order; present only when `grid` is set. */
  tiles?: GridTile[]
  /** Raw EXIF item payload (TIFF stream) when an `Exif`-typed item exists. */
  exifData?: Uint8Array
}

/** A single frame extracted from an animated HEIC sequence. */
export interface AnimationSample {
  data: Uint8Array
  /** Intended display duration in milliseconds (from stts). */
  durationMs: number
}

/** Extracted payload for an animated HEIC sequence. */
export interface AnimationData {
  samples: AnimationSample[]
  hvcC: HvcCInfo
  width: number
  height: number
}

// ─── Internal Box Types ───────────────────────────────────────────────────────

interface ISOBox {
  type: string
  /** Total box size in bytes (including 8-byte header). */
  size: number
  /** Absolute byte offset of the first byte of this box. */
  offset: number
  /** Absolute byte offset of box payload (after size + type). */
  contentOffset: number
}

// ─── Box Navigation ───────────────────────────────────────────────────────────

function readBox(view: DataView, offset: number): ISOBox | null {
  if (offset + 8 > view.byteLength) return null

  let size = view.getUint32(offset, false)
  const type = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7),
  )

  let contentOffset = offset + 8

  if (size === 1) {
    // Extended size (largesize field follows the type)
    if (offset + 16 > view.byteLength) return null
    const hi = view.getUint32(offset + 8, false)
    const lo = view.getUint32(offset + 12, false)
    // NOTE: hi * 2^32 may overflow Number for files >4 GB; acceptable here
    size = hi * 0x100000000 + lo
    contentOffset = offset + 16
  } else if (size === 0) {
    size = view.byteLength - offset // box extends to end of file
  }

  return { type, size, offset, contentOffset }
}

/** Finds the first immediate child box matching `type` within [start, end). */
function findBox(view: DataView, type: string, start: number, end: number): ISOBox | null {
  let offset = start
  while (offset + 8 <= end) {
    const box = readBox(view, offset)
    if (!box || box.size < 8) break
    if (box.type === type) return box
    offset += box.size
  }
  return null
}

/** Enumerates all immediate child boxes within [start, end). */
function listBoxes(view: DataView, start: number, end: number): ISOBox[] {
  const result: ISOBox[] = []
  let offset = start
  while (offset + 8 <= end) {
    const box = readBox(view, offset)
    if (!box || box.size < 8) break
    result.push(box)
    offset += box.size
  }
  return result
}

/**
 * Returns the content offset of a FullBox, skipping version(1) + flags(3) = 4 bytes.
 * Use this whenever a box spec says "extends FullBox".
 */
function fbContent(box: ISOBox): number {
  return box.contentOffset + 4
}

// ─── hvcC Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses an HEVCDecoderConfigurationRecord (hvcC box payload) and returns
 * the WebCodecs codec string, NAL unit length size, and raw description bytes.
 *
 * @param view  DataView over the full file buffer.
 * @param start Absolute offset of the first record byte (after box 8-byte header).
 * @param size  Byte length of the record.
 */
function parseHvcC(view: DataView, start: number, size: number): HvcCInfo {
  // Byte 0: configurationVersion (= 1, not needed)
  // Byte 1: profile_space(2b) | tier_flag(1b) | profile_idc(5b)
  const b1 = view.getUint8(start + 1)
  const profileSpace = (b1 >> 6) & 0x3
  const tierFlag = (b1 >> 5) & 0x1
  const profileIdc = b1 & 0x1f

  // Bytes 2–5: general_profile_compatibility_flags (32-bit BE)
  const compatFlags = view.getUint32(start + 2, false)

  // Bytes 6–11: general_constraint_indicator_flags (6 bytes)
  const constraintBytes: number[] = []
  for (let i = 0; i < 6; i++) constraintBytes.push(view.getUint8(start + 6 + i))

  // Byte 12: general_level_idc
  const levelIdc = view.getUint8(start + 12)

  // Byte 21 bits[1:0]: lengthSizeMinusOne → naluLengthSize
  const naluLengthSize = (view.getUint8(start + 21) & 0x3) + 1

  // Build codec string per ISO/IEC 14496-15 Annex E:
  //   hvc1.<PS><prof_idc>.<compat_flags_hex>.<T><level_idc>[.<constraint_hex>]
  const psPrefix = (['', 'A', 'B', 'C'] as const)[profileSpace] ?? ''
  const tier = tierFlag ? 'H' : 'L'
  const compatHex = compatFlags.toString(16).toUpperCase() || '0'

  // Trim trailing zero bytes from constraint flags
  let ctEnd = constraintBytes.length - 1
  while (ctEnd >= 0 && constraintBytes[ctEnd] === 0) ctEnd--
  const constraintHex =
    ctEnd >= 0
      ? constraintBytes
          .slice(0, ctEnd + 1)
          .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
          .join('')
      : ''

  const parts = [`hvc1.${psPrefix}${profileIdc}`, compatHex, `${tier}${levelIdc}`]
  if (constraintHex) parts.push(constraintHex)

  return {
    codecString: parts.join('.'),
    naluLengthSize,
    description: new Uint8Array(view.buffer, start, Math.min(size, view.byteLength - start)).slice(),
  }
}

// ─── Static HEIC Extraction ───────────────────────────────────────────────────

/**
 * Extracts the primary HEVC-coded frame and decoder configuration from a
 * static HEIC file (ftyp brand: heic / heix / mif1).
 *
 * Returns null when the file cannot be parsed or does not contain an HEVC item.
 */
export function extractStaticFrame(buffer: ArrayBuffer): StaticFrameData | null {
  try {
    const view = new DataView(buffer)
    const fileEnd = buffer.byteLength

    // ── meta (FullBox at top level) ──────────────────────────────────────
    const metaBox = findBox(view, 'meta', 0, fileEnd)
    if (!metaBox) return null
    const metaContent = fbContent(metaBox) // past FullBox version + flags
    const metaEnd = metaBox.offset + metaBox.size

    // ── pitm: primary item ID ─────────────────────────────────────────────
    const pitmBox = findBox(view, 'pitm', metaContent, metaEnd)
    if (!pitmBox) return null
    const pitmVersion = view.getUint8(pitmBox.contentOffset)
    const primaryItemId =
      pitmVersion === 0
        ? view.getUint16(fbContent(pitmBox), false)
        : view.getUint32(fbContent(pitmBox), false)

    // ── iinf: item info (item_id → item_type) ────────────────────────────
    const iinfBox = findBox(view, 'iinf', metaContent, metaEnd)
    if (!iinfBox) return null
    const iinfVersion = view.getUint8(iinfBox.contentOffset)
    const infeStart = fbContent(iinfBox) + (iinfVersion === 0 ? 2 : 4)
    const iinfEnd = iinfBox.offset + iinfBox.size
    const itemTypeMap = new Map<number, string>()

    for (const infe of listBoxes(view, infeStart, iinfEnd)) {
      if (infe.type !== 'infe') continue
      const infeVer = view.getUint8(infe.contentOffset)
      if (infeVer < 2) continue // v0/v1 use a different layout; not needed here
      const fc = fbContent(infe)
      const itemId = infeVer === 2 ? view.getUint16(fc, false) : view.getUint32(fc, false)
      const idSize = infeVer === 2 ? 2 : 4
      const typeOff = fc + idSize + 2 // skip item_protection_index (2 bytes)
      if (typeOff + 4 <= view.byteLength) {
        itemTypeMap.set(
          itemId,
          String.fromCharCode(
            view.getUint8(typeOff),
            view.getUint8(typeOff + 1),
            view.getUint8(typeOff + 2),
            view.getUint8(typeOff + 3),
          ),
        )
      }
    }

    // ── iloc: item locations ──────────────────────────────────────────────
    const ilocBox = findBox(view, 'iloc', metaContent, metaEnd)
    if (!ilocBox) return null

    const ilocVersion = view.getUint8(ilocBox.contentOffset)
    let pos = fbContent(ilocBox)

    const offsetSize = (view.getUint8(pos) >> 4) & 0xf
    const lengthSize = view.getUint8(pos) & 0xf
    pos++
    const baseOffsetSize = (view.getUint8(pos) >> 4) & 0xf
    pos++

    const ilocItemCount =
      ilocVersion < 2 ? view.getUint16(pos, false) : view.getUint32(pos, false)
    pos += ilocVersion < 2 ? 2 : 4

    // Read N-byte big-endian unsigned integer (0, 4, or 8 bytes supported)
    const readN = (p: number, n: number): number => {
      if (n === 0) return 0
      if (n === 4) return view.getUint32(p, false)
      if (n === 8) return view.getUint32(p + 4, false) // low 32 bits; hi ignored (>4 GB)
      return 0
    }

    interface IlocEntry {
      constructionMethod: number
      baseOffset: number
      extents: Array<{ offset: number; length: number }>
    }
    const ilocMap = new Map<number, IlocEntry>()

    for (let i = 0; i < ilocItemCount; i++) {
      const itemId =
        ilocVersion < 2 ? view.getUint16(pos, false) : view.getUint32(pos, false)
      pos += ilocVersion < 2 ? 2 : 4

      let constructionMethod = 0
      if (ilocVersion >= 1) {
        constructionMethod = view.getUint16(pos, false) & 0xf
        pos += 2
      }
      pos += 2 // data_reference_index

      const baseOffset = readN(pos, baseOffsetSize)
      pos += baseOffsetSize

      const extentCount = view.getUint16(pos, false)
      pos += 2

      const extents: Array<{ offset: number; length: number }> = []
      for (let j = 0; j < extentCount; j++) {
        const extOffset = readN(pos, offsetSize)
        pos += offsetSize
        const extLength = readN(pos, lengthSize)
        pos += lengthSize
        extents.push({ offset: extOffset, length: extLength })
      }
      ilocMap.set(itemId, { constructionMethod, baseOffset, extents })
    }

    // ── iprp → ipco + ipma ────────────────────────────────────────────────
    const iprpBox = findBox(view, 'iprp', metaContent, metaEnd)
    if (!iprpBox) return null
    const iprpEnd = iprpBox.offset + iprpBox.size

    const ipcoBox = findBox(view, 'ipco', iprpBox.contentOffset, iprpEnd)
    const ipmaBox = findBox(view, 'ipma', iprpBox.contentOffset, iprpEnd)
    if (!ipcoBox || !ipmaBox) return null

    // ── Build per-item property lookup from ipma (needed for tile items) ──
    // We read ALL items' property associations in one pass.
    const ipmaVersion = view.getUint8(ipmaBox.contentOffset)
    const ipmaFlags = view.getUint32(ipmaBox.contentOffset, false) & 0xffffff
    const use16BitIdx = (ipmaFlags & 1) !== 0
    let ipmaPos = fbContent(ipmaBox)
    const ipmaEntryCount = view.getUint32(ipmaPos, false)
    ipmaPos += 4

    // itemPropMap: itemId → Set of 1-based ipco property indices
    const itemPropMap = new Map<number, Set<number>>()
    for (let i = 0; i < ipmaEntryCount; i++) {
      const assocItemId =
        ipmaVersion === 0 ? view.getUint16(ipmaPos, false) : view.getUint32(ipmaPos, false)
      ipmaPos += ipmaVersion === 0 ? 2 : 4
      const assocCount = view.getUint8(ipmaPos++)
      if (!itemPropMap.has(assocItemId)) itemPropMap.set(assocItemId, new Set())
      for (let j = 0; j < assocCount; j++) {
        let idx: number
        if (use16BitIdx) { idx = view.getUint16(ipmaPos, false) & 0x7fff; ipmaPos += 2 }
        else { idx = view.getUint8(ipmaPos++) & 0x7f }
        itemPropMap.get(assocItemId)!.add(idx)
      }
    }

    // Walk ipco to enumerate all property boxes.
    const ipcoEnd = ipcoBox.offset + ipcoBox.size
    const propBoxes = listBoxes(view, ipcoBox.contentOffset, ipcoEnd)

    /** Resolve hvcC and ispe for a given item from the ipco/ipma tables. */
    const resolveItemProps = (itemId: number): { hvcC: HvcCInfo | null; width: number; height: number } => {
      // Fall back to all properties when no ipma entry exists for this item.
      const indices = itemPropMap.get(itemId)
        ?? new Set(Array.from({ length: propBoxes.length }, (_, k) => k + 1))
      let hvcC: HvcCInfo | null = null
      let w = 0
      let h = 0
      for (let pi = 0; pi < propBoxes.length; pi++) {
        const propBox = propBoxes[pi]
        if (!indices.has(pi + 1)) continue
        if (propBox.type === 'hvcC' && !hvcC) {
          const recordSize = propBox.size - (propBox.contentOffset - propBox.offset)
          hvcC = parseHvcC(view, propBox.contentOffset, recordSize)
        } else if (propBox.type === 'ispe') {
          const fc = fbContent(propBox)
          w = view.getUint32(fc, false)
          h = view.getUint32(fc + 4, false)
        }
      }
      return { hvcC, width: w, height: h }
    }

    /** Extract raw sample bytes for a given iloc entry. */
    const extractSampleData = (loc: IlocEntry): Uint8Array | null => {
      if (loc.extents.length === 0) return null
      if (loc.constructionMethod === 1) {
        const idatBox = findBox(view, 'idat', metaContent, metaEnd)
        if (!idatBox) return null
        return gatherExtents(view, loc.extents, idatBox.contentOffset, loc.baseOffset)
      }
      return gatherExtents(view, loc.extents, 0, loc.baseOffset)
    }

    // ── EXIF item (orientation) ───────────────────────────────────────────
    // HEIC stores EXIF metadata as a separate item of type 'Exif'.  Its raw
    // payload is a TIFF stream (optionally prefixed with `Exif\0\0`) that the
    // EXIF reader in utils/exif.ts parses for the Orientation tag.
    let exifData: Uint8Array | undefined
    for (const [itemId, type] of itemTypeMap) {
      if (type !== 'Exif') continue
      const exifLoc = ilocMap.get(itemId)
      if (!exifLoc) continue
      const raw = extractSampleData(exifLoc)
      if (raw && raw.byteLength > 0) {
        exifData = raw
        break
      }
    }

    // ── Grid (tile-based) HEIC ────────────────────────────────────────────
    // iPhone HEIC photos use a 'grid' derived image as primary item.
    // The grid item has no hvcC; actual pixels live in child tile items
    // referenced via iref/dimg.
    const primaryItemType = itemTypeMap.get(primaryItemId)
    if (primaryItemType === 'grid') {
      // Parse iref to find dimg (derived image) tile references
      const irefBox = findBox(view, 'iref', metaContent, metaEnd)
      if (!irefBox) return null

      const irefVersion = view.getUint8(irefBox.contentOffset)
      const irefContent = fbContent(irefBox)
      const irefEnd = irefBox.offset + irefBox.size

      let tileItemIds: number[] = []
      let posRef = irefContent
      while (posRef + 8 <= irefEnd) {
        let refSize = view.getUint32(posRef, false)
        const refType = String.fromCharCode(
          view.getUint8(posRef + 4), view.getUint8(posRef + 5),
          view.getUint8(posRef + 6), view.getUint8(posRef + 7),
        )
        let refContentPos = posRef + 8
        if (refSize === 1) {
          refSize = view.getUint32(posRef + 8, false) * 0x100000000 + view.getUint32(posRef + 12, false)
          refContentPos = posRef + 16
        } else if (refSize === 0) {
          refSize = irefEnd - posRef
        }
        const fromItemId = irefVersion === 0
          ? view.getUint16(refContentPos, false)
          : view.getUint32(refContentPos, false)
        refContentPos += irefVersion === 0 ? 2 : 4
        const refCount = view.getUint16(refContentPos, false)
        refContentPos += 2
        if (refType === 'dimg' && fromItemId === primaryItemId) {
          for (let ti = 0; ti < refCount; ti++) {
            tileItemIds.push(irefVersion === 0
              ? view.getUint16(refContentPos + ti * 2, false)
              : view.getUint32(refContentPos + ti * 4, false))
          }
          break
        }
        posRef += refSize
      }
      if (tileItemIds.length === 0) return null

      // Parse grid image item data (rows, columns, output dimensions).
      // ImageGrid payload: version(1) | flags(1) | rows_minus_one(1) | columns_minus_one(1)
      //   [flags & 1: output_width(4) output_height(4)] or [output_width(2) output_height(2)]
      let gridInfo: GridInfo | undefined
      const primaryLocGrid = ilocMap.get(primaryItemId)
      if (primaryLocGrid && primaryLocGrid.extents.length > 0) {
        const gridRaw = extractSampleData(primaryLocGrid)
        if (gridRaw && gridRaw.byteLength >= 4) {
          const gv = new DataView(gridRaw.buffer, gridRaw.byteOffset, gridRaw.byteLength)
          const gridFlags = gv.getUint8(1)
          const rows = gv.getUint8(2) + 1
          const columns = gv.getUint8(3) + 1
          const use32 = (gridFlags & 1) !== 0
          const outputWidth = use32 ? gv.getUint32(4, false) : gv.getUint16(4, false)
          const outputHeight = use32 ? gv.getUint32(8, false) : gv.getUint16(6, false)
          gridInfo = { rows, columns, outputWidth, outputHeight }
        }
      }

      // Resolve each tile item
      const tiles: GridTile[] = []
      for (const tileId of tileItemIds) {
        const { hvcC: tileHvcC, width: tileW, height: tileH } = resolveItemProps(tileId)
        if (!tileHvcC) continue
        const tileLoc = ilocMap.get(tileId)
        if (!tileLoc) continue
        const tileSample = extractSampleData(tileLoc)
        if (!tileSample) continue
        tiles.push({ sampleData: tileSample, hvcC: tileHvcC, width: tileW, height: tileH })
      }
      if (tiles.length === 0) return null

      // Top-level fields mirror the first tile for backward-compatible callers
      const first = tiles[0]
      return {
        sampleData: first.sampleData,
        hvcC: first.hvcC,
        width: gridInfo?.outputWidth ?? first.width,
        height: gridInfo?.outputHeight ?? first.height,
        grid: gridInfo,
        tiles,
        exifData,
      }
    }

    // ── Non-grid (simple) HEIC ────────────────────────────────────────────
    const primaryLoc = ilocMap.get(primaryItemId)
    if (!primaryLoc || primaryLoc.extents.length === 0) return null

    const { hvcC: hvcCInfo, width, height } = resolveItemProps(primaryItemId)
    if (!hvcCInfo) return null

    const sampleData = extractSampleData(primaryLoc)
    if (!sampleData) return null

    return { sampleData, hvcC: hvcCInfo, width, height, exifData }
  } catch {
    return null
  }
}

// ─── Animated HEIC Extraction ─────────────────────────────────────────────────

/**
 * Extracts all HEVC-coded frames and per-frame timing from an animated HEIC
 * sequence file (ftyp brand: msf1 / hevc / hevx).
 *
 * Returns null when the file structure cannot be parsed.
 */
export function extractAnimationSamples(buffer: ArrayBuffer): AnimationData | null {
  try {
    const view = new DataView(buffer)
    const fileEnd = buffer.byteLength

    // ── moov ──────────────────────────────────────────────────────────────
    const moovBox = findBox(view, 'moov', 0, fileEnd)
    if (!moovBox) return null
    const moovEnd = moovBox.offset + moovBox.size

    const trakBox = findBox(view, 'trak', moovBox.contentOffset, moovEnd)
    if (!trakBox) return null
    const trakEnd = trakBox.offset + trakBox.size

    // ── mdia → mdhd (timescale) ───────────────────────────────────────────
    const mdiaBox = findBox(view, 'mdia', trakBox.contentOffset, trakEnd)
    if (!mdiaBox) return null
    const mdiaEnd = mdiaBox.offset + mdiaBox.size

    const mdhdBox = findBox(view, 'mdhd', mdiaBox.contentOffset, mdiaEnd)
    if (!mdhdBox) return null
    const mdhdVersion = view.getUint8(mdhdBox.contentOffset)
    const mdhdFC = fbContent(mdhdBox)
    // v0: creation(4) + modification(4) + timescale(4)
    // v1: creation(8) + modification(8) + timescale(4)
    const timescale =
      mdhdVersion === 1
        ? view.getUint32(mdhdFC + 16, false)
        : view.getUint32(mdhdFC + 8, false)

    // ── minf → stbl ────────────────────────────────────────────────────────
    const minfBox = findBox(view, 'minf', mdiaBox.contentOffset, mdiaEnd)
    if (!minfBox) return null
    const minfEnd = minfBox.offset + minfBox.size

    const stblBox = findBox(view, 'stbl', minfBox.contentOffset, minfEnd)
    if (!stblBox) return null
    const stblEnd = stblBox.offset + stblBox.size

    // ── stsd → hvc1/hev1 sample entry → hvcC + dimensions ────────────────
    const stsdBox = findBox(view, 'stsd', stblBox.contentOffset, stblEnd)
    if (!stsdBox) return null
    const stsdEnd = stsdBox.offset + stsdBox.size
    // stsd: FullBox(4) + entry_count(4) = 8 bytes before entries
    const stsdEntriesStart = fbContent(stsdBox) + 4

    let hvcCInfo: HvcCInfo | null = null
    let width = 0
    let height = 0

    for (const entry of listBoxes(view, stsdEntriesStart, stsdEnd)) {
      if (entry.type !== 'hvc1' && entry.type !== 'hev1') continue

      // VisualSampleEntry layout (ISO 14496-12 §12.1.3):
      //  +0   6 bytes  reserved
      //  +6   2 bytes  data_reference_index
      //  +8   2 bytes  pre_defined
      //  +10  2 bytes  reserved
      //  +12  12 bytes pre_defined
      //  +24  2 bytes  width       ← here
      //  +26  2 bytes  height      ← here
      //  +28 ...       other fields + child boxes at +78
      width = view.getUint16(entry.contentOffset + 24, false)
      height = view.getUint16(entry.contentOffset + 26, false)

      const childStart = entry.contentOffset + 78
      const childEnd = entry.offset + entry.size
      const hvcCBox = findBox(view, 'hvcC', childStart, childEnd)
      if (hvcCBox) {
        const recordSize = hvcCBox.size - (hvcCBox.contentOffset - hvcCBox.offset)
        hvcCInfo = parseHvcC(view, hvcCBox.contentOffset, recordSize)
      }
      break
    }
    if (!hvcCInfo) return null

    // ── stts: time-to-sample → per-sample delta ───────────────────────────
    const sttsBox = findBox(view, 'stts', stblBox.contentOffset, stblEnd)
    if (!sttsBox) return null
    const sttsFC = fbContent(sttsBox)
    const sttsEntryCount = view.getUint32(sttsFC, false)

    const perSampleDelta: number[] = []
    for (let i = 0; i < sttsEntryCount; i++) {
      const count = view.getUint32(sttsFC + 4 + i * 8, false)
      const delta = view.getUint32(sttsFC + 4 + i * 8 + 4, false)
      for (let j = 0; j < count; j++) perSampleDelta.push(delta)
    }
    const sampleCount = perSampleDelta.length

    // ── stsz: sample sizes ────────────────────────────────────────────────
    const stszBox = findBox(view, 'stsz', stblBox.contentOffset, stblEnd)
    if (!stszBox) return null
    const stszFC = fbContent(stszBox)
    const defaultSize = view.getUint32(stszFC, false)
    const stszCount = view.getUint32(stszFC + 4, false)
    const sampleSizes: number[] = []
    if (defaultSize !== 0) {
      for (let i = 0; i < stszCount; i++) sampleSizes.push(defaultSize)
    } else {
      for (let i = 0; i < stszCount; i++) {
        sampleSizes.push(view.getUint32(stszFC + 8 + i * 4, false))
      }
    }

    // ── stsc: sample-to-chunk ────────────────────────────────────────────
    const stscBox = findBox(view, 'stsc', stblBox.contentOffset, stblEnd)
    if (!stscBox) return null
    const stscFC = fbContent(stscBox)
    const stscEntryCount = view.getUint32(stscFC, false)
    const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = []
    for (let i = 0; i < stscEntryCount; i++) {
      stscEntries.push({
        firstChunk: view.getUint32(stscFC + 4 + i * 12, false),
        samplesPerChunk: view.getUint32(stscFC + 4 + i * 12 + 4, false),
      })
    }

    // ── stco / co64: chunk offsets ────────────────────────────────────────
    const stcoBox = findBox(view, 'stco', stblBox.contentOffset, stblEnd)
    const co64Box = findBox(view, 'co64', stblBox.contentOffset, stblEnd)
    const chunkOffsets: number[] = []

    if (stcoBox) {
      const fc = fbContent(stcoBox)
      const count = view.getUint32(fc, false)
      for (let i = 0; i < count; i++) {
        chunkOffsets.push(view.getUint32(fc + 4 + i * 4, false))
      }
    } else if (co64Box) {
      const fc = fbContent(co64Box)
      const count = view.getUint32(fc, false)
      for (let i = 0; i < count; i++) {
        // Ignore hi word: >4 GB files not realistically encountered for HEIC images
        chunkOffsets.push(view.getUint32(fc + 4 + i * 8 + 4, false))
      }
    } else {
      return null
    }

    // ── Build per-sample file offsets via stsc + stco/co64 ────────────────
    const sampleFileOffsets: number[] = []
    let sampleIdx = 0

    /** Returns samplesPerChunk for the given 1-indexed chunk number. */
    const getSamplesPerChunk = (chunkNumber: number): number => {
      let spc = stscEntries[0]?.samplesPerChunk ?? 1
      // stsc entries are in ascending firstChunk order
      for (const e of stscEntries) {
        if (e.firstChunk <= chunkNumber) spc = e.samplesPerChunk
        else break
      }
      return spc
    }

    for (
      let chunkIdx = 0;
      chunkIdx < chunkOffsets.length && sampleIdx < sampleCount;
      chunkIdx++
    ) {
      const chunkNumber = chunkIdx + 1 // stsc uses 1-based chunk numbers
      const samplesInChunk = getSamplesPerChunk(chunkNumber)
      let byteOffset = chunkOffsets[chunkIdx]
      for (let s = 0; s < samplesInChunk && sampleIdx < sampleCount; s++, sampleIdx++) {
        sampleFileOffsets.push(byteOffset)
        byteOffset += sampleSizes[sampleIdx]
      }
    }

    // ── Assemble AnimationSample array ────────────────────────────────────
    const samples: AnimationSample[] = []
    const frameCount = Math.min(sampleFileOffsets.length, sampleCount)
    for (let i = 0; i < frameCount; i++) {
      samples.push({
        data: new Uint8Array(buffer, sampleFileOffsets[i], sampleSizes[i]).slice(),
        durationMs:
          timescale > 0 ? (perSampleDelta[i] / timescale) * 1000 : 1000 / 24,
      })
    }

    return { samples, hvcC: hvcCInfo!, width, height }
  } catch {
    return null
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Reads and concatenates one or more extents from the file buffer.
 * `baseStart` + `baseOffset` + `ext.offset` gives each extent's absolute start.
 * `ext.length === 0` is interpreted as "to end of file" (per ISOBMFF spec).
 */
function gatherExtents(
  view: DataView,
  extents: Array<{ offset: number; length: number }>,
  baseStart: number,
  baseOffset: number,
): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const ext of extents) {
    const start = baseStart + baseOffset + ext.offset
    const len = ext.length === 0 ? view.byteLength - start : ext.length
    chunks.push(new Uint8Array(view.buffer, start, len).slice())
  }
  const total = chunks.reduce((s, c) => s + c.byteLength, 0)
  const result = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    result.set(c, off)
    off += c.byteLength
  }
  return result
}
