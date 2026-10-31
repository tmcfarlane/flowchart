// Read pixel dimensions from a raster data URL's header without decoding the
// image, so synchronous layout code can keep the picture's aspect ratio.
export function imageDataUrlSize(dataUrl: string): { width: number; height: number } | null {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,/i.exec(dataUrl)
  if (!match) return null
  let bytes: Uint8Array
  try {
    // JPEG frame headers usually sit within the first few KB; 64 KB of base64 is ample.
    const head = dataUrl.slice(match[0].length, match[0].length + 65536)
    const binary = atob(head.slice(0, head.length - (head.length % 4)))
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  } catch {
    return null
  }
  const u16be = (at: number) => (bytes[at] << 8) | bytes[at + 1]
  const u16le = (at: number) => bytes[at] | (bytes[at + 1] << 8)
  const u24le = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
  const u32be = (at: number) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
  const size = (width: number, height: number) => width > 0 && height > 0 ? { width, height } : null
  const type = match[1].toLowerCase()
  if (type === 'png' && bytes.length >= 24) return size(u32be(16), u32be(20))
  if (type === 'gif' && bytes.length >= 10) return size(u16le(6), u16le(8))
  if (type === 'webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16))
    if (chunk === 'VP8 ') return size(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
    if (chunk === 'VP8L') {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') return size(u24le(24) + 1, u24le(27) + 1)
    return null
  }
  if (type === 'jpeg') {
    let at = 2
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1]
      // SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return size(u16be(at + 7), u16be(at + 5))
      at += 2 + u16be(at + 2)
    }
  }
  return null
}
