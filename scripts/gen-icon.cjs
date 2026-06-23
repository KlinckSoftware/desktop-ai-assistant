// Generates resources/icon.ico (+ icon.png) — a simple CLI-prompt mark (">_")
// in the app accent on the dark panel bg, rounded corners. No external tooling:
// rasterizes by hand, encodes a PNG (zlib), and wraps it in a PNG-in-ICO.
// Run: node scripts/gen-icon.cjs
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const S = 256
const buf = Buffer.alloc(S * S * 4) // RGBA

const BG = [13, 17, 23] // #0d1117
const FG = [88, 166, 255] // #58a6ff accent
const R = 44 // corner radius

function set(x, y, [r, g, b], a = 255) {
  const i = (y * S + x) * 4
  // simple over-blend onto whatever's there
  const ia = a / 255
  buf[i] = Math.round(r * ia + buf[i] * (1 - ia))
  buf[i + 1] = Math.round(g * ia + buf[i + 1] * (1 - ia))
  buf[i + 2] = Math.round(b * ia + buf[i + 2] * (1 - ia))
  buf[i + 3] = Math.max(buf[i + 3], a)
}

// distance from point to segment
function distSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - x0) * dx + (py - y0) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = x0 + t * dx
  const cy = y0 + t * dy
  return Math.hypot(px - cx, py - cy)
}

// rounded-rect coverage (1 inside, 0 outside, soft edge)
function bgAlpha(x, y) {
  const cx = Math.min(x, S - 1 - x)
  const cy = Math.min(y, S - 1 - y)
  if (cx >= R || cy >= R) return 1
  const d = Math.hypot(R - cx, R - cy)
  return d <= R ? 1 : d <= R + 1 ? R + 1 - d : 0
}

// Mark: a hub-and-spoke "orchestrator" — a central node routing to several agent
// nodes. On-brand for a multi-agent cockpit (and not the generic terminal ">_").
const FG2 = [163, 113, 247] // #a371f7 secondary accent (satellites), adds depth
const C = [128, 128]
const sats = [
  [128, 58], // top
  [62, 178], // lower-left
  [194, 178] // lower-right
]
const SPOKE = 11 // spoke stroke width
const RC = 30 // center node radius
const RS = 18 // satellite radius

function coverSeg(x, y, x0, y0, x1, y1, w) {
  const d = distSeg(x, y, x0, y0, x1, y1)
  return d <= w / 2 ? 1 : d <= w / 2 + 1.5 ? w / 2 + 1.5 - d : 0
}
function coverDisc(x, y, cx, cy, r) {
  const d = Math.hypot(x - cx, y - cy)
  return d <= r ? 1 : d <= r + 1.5 ? r + 1.5 - d : 0
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const ba = bgAlpha(x, y)
    if (ba <= 0) continue
    set(x, y, BG, Math.round(255 * ba))
    // spokes (under everything)
    let spoke = 0
    for (const s of sats) spoke = Math.max(spoke, coverSeg(x, y, C[0], C[1], s[0], s[1], SPOKE))
    if (spoke > 0) set(x, y, FG, Math.round(255 * spoke * ba))
    // satellite nodes (secondary accent)
    let satc = 0
    for (const s of sats) satc = Math.max(satc, coverDisc(x, y, s[0], s[1], RS))
    if (satc > 0) set(x, y, FG2, Math.round(255 * satc * ba))
    // center node (primary accent) on top
    const cc = coverDisc(x, y, C[0], C[1], RC)
    if (cc > 0) set(x, y, FG, Math.round(255 * cc * ba))
  }
}

// --- PNG encode ---
function crc32(b) {
  let c = ~0
  for (let i = 0; i < b.length; i++) {
    c ^= b[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(S * (1 + S * 4))
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 4)] = 0 // filter none
  buf.copy(raw, y * (1 + S * 4) + 1, y * S * 4, (y + 1) * S * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

// --- ICO wrap (single PNG entry) ---
const dir = Buffer.alloc(6 + 16)
dir.writeUInt16LE(0, 0)
dir.writeUInt16LE(1, 2) // type icon
dir.writeUInt16LE(1, 4) // count
dir[6] = 0 // width 256
dir[7] = 0 // height 256
dir.writeUInt16LE(1, 10) // planes
dir.writeUInt16LE(32, 12) // bpp
dir.writeUInt32LE(png.length, 14)
dir.writeUInt32LE(22, 18) // offset
const ico = Buffer.concat([dir, png])

const out = path.join(__dirname, '..', 'resources')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'icon.png'), png)
fs.writeFileSync(path.join(out, 'icon.ico'), ico)
console.log(`wrote resources/icon.png (${png.length}B) + icon.ico (${ico.length}B)`)
