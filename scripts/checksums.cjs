// Emit SHA256SUMS.txt next to the built installers so recipients can verify
// integrity (the build is unsigned). Run after electron-builder.
//   node scripts/checksums.cjs
const { createHash } = require('crypto')
const { readdirSync, readFileSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')

const dir = join(__dirname, '..', 'release')
if (!existsSync(dir)) {
  console.warn('[checksums] no release/ dir — nothing to hash')
  process.exit(0)
}
const files = readdirSync(dir).filter((f) => /\.(exe|dmg|AppImage|deb|zip)$/i.test(f))
if (!files.length) {
  console.warn('[checksums] no installer artifacts found')
  process.exit(0)
}
const lines = files.sort().map((f) => {
  const hash = createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')
  return `${hash}  ${f}`
})
writeFileSync(join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n')
console.log('[checksums] wrote release/SHA256SUMS.txt:\n' + lines.join('\n'))
