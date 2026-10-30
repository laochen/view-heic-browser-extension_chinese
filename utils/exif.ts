/**
 * utils/exif.ts
 *
 * Minimal, dependency-free EXIF Orientation (tag 0x0112) reader.
 *
 * HEIC files carry EXIF metadata as a separate ISOBMFF item whose payload is a
 * raw TIFF stream: an optional `Exif\0\0` prefix followed by a TIFF header
 * (`II*\0` for little-endian or `MM\0*` for big-endian) and one or more IFDs.
 *
 * We only need the Orientation tag from IFD0, so this parser is intentionally
 * tiny (~50 lines) and returns a value in 1..8 (1 = "normal, no rotation").
 */

/** EXIF Orientation values. 1 means "upright, no transformation needed". */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/**
 * Extracts the EXIF Orientation value from a raw EXIF/TIFF byte payload.
 *
 * Returns 1 (upright) when no TIFF header, IFD0, or Orientation tag can be
 * found, or when any read would go out of bounds — a safe default that leaves
 * the image unrotated.
 *
 * @param exifData Raw bytes of the EXIF item (may include `Exif\0\0` prefix).
 */
export function getExifOrientation(exifData: Uint8Array): ExifOrientation {
  if (!exifData || exifData.byteLength < 8) return 1

  // ── Locate the TIFF header within the first few KB ──────────────────────
  // HEIC Exif items often begin with an `Exif\0\0` 6-byte prefix; the actual
  // TIFF stream starts right after.  We scan a small window for either magic.
  const scanLimit = Math.min(exifData.byteLength - 8, 1024)
  let tiffOffset = -1
  let littleEndian = true

  for (let i = 0; i <= scanLimit; i++) {
    const b0 = exifData[i]
    const b1 = exifData[i + 1]
    // Little-endian: 'II' (0x49 0x49) + 0x2A00
    if (b0 === 0x49 && b1 === 0x49 && exifData[i + 2] === 0x2a && exifData[i + 3] === 0x00) {
      tiffOffset = i
      littleEndian = true
      break
    }
    // Big-endian: 'MM' (0x4D 0x4D) + 0x002A
    if (b0 === 0x4d && b1 === 0x4d && exifData[i + 2] === 0x00 && exifData[i + 3] === 0x2a) {
      tiffOffset = i
      littleEndian = false
      break
    }
  }
  if (tiffOffset < 0) return 1

  const view = new DataView(
    exifData.buffer,
    exifData.byteOffset + tiffOffset,
    exifData.byteLength - tiffOffset,
  )

  // IFD0 offset (relative to TIFF header) sits at bytes 4..7 of the header.
  if (view.byteLength < 8) return 1
  const ifd0Offset = view.getUint32(4, littleEndian)
  if (ifd0Offset < 8 || ifd0Offset + 2 > view.byteLength) return 1

  // IFD0 layout: entryCount(2) + entryCount * 12-byte entries + nextIFDOffset(4).
  const entryCount = view.getUint16(ifd0Offset, littleEndian)
  const entriesStart = ifd0Offset + 2
  if (entriesStart + entryCount * 12 > view.byteLength) return 1

  // Each IFD entry: tag(2) type(2) count(4) value-or-offset(4).
  // Orientation is a SHORT (type 1) with count 1, so its value fits inline in
  // the first 2 bytes of the 4-byte value field.
  for (let e = 0; e < entryCount; e++) {
    const entryOff = entriesStart + e * 12
    const tag = view.getUint16(entryOff, littleEndian)
    if (tag !== 0x0112) continue

    const type = view.getUint16(entryOff + 2, littleEndian)
    if (type !== 3) continue // 3 = SHORT

    const value = view.getUint16(entryOff + 8, littleEndian)
    if (value >= 1 && value <= 8) return value as ExifOrientation
    return 1
  }

  return 1
}
