// Packs the viewer built into the host module's assets (web:build) as assets/viewer.zip: the app requires
// it, so it goes in every EAS Update, and the native host serves the viewer from it (unpacked once per
// version) instead of the one built into the APK. Stored, not compressed: what weighs is wasm and
// already compressed images, and an update's assets are compressed on their way anyway.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))
const from = join(here, 'modules/estanteria-host/android/src/main/assets/viewer')
const to = join(here, 'assets/viewer.zip')

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(data) {
  let c = 0xffffffff
  for (const b of data) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function files(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const parts = []
const central = []
let offset = 0
for (const path of files(from)) {
  const name = Buffer.from(relative(from, path).split(sep).join('/'))
  const data = readFileSync(path)
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)               // version needed
  local.writeUInt16LE(0x0800, 6)           // names in UTF-8
  local.writeUInt16LE(0, 8)                // stored
  local.writeUInt32LE(0, 10)               // time and date: none (the same zip for the same files)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  const entry = Buffer.alloc(46)
  entry.writeUInt32LE(0x02014b50, 0)
  entry.writeUInt16LE(20, 4)
  entry.writeUInt16LE(20, 6)
  entry.writeUInt16LE(0x0800, 8)
  entry.writeUInt16LE(0, 10)
  entry.writeUInt32LE(0, 12)
  entry.writeUInt32LE(crc, 16)
  entry.writeUInt32LE(data.length, 20)
  entry.writeUInt32LE(data.length, 24)
  entry.writeUInt16LE(name.length, 28)
  entry.writeUInt32LE(offset, 42)
  parts.push(local, name, data)
  central.push(entry, name)
  offset += local.length + name.length + data.length
}
const centralSize = central.reduce((n, b) => n + b.length, 0)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(central.length / 2, 8)
end.writeUInt16LE(central.length / 2, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)
writeFileSync(to, Buffer.concat([...parts, ...central, end]))
console.log(`assets/viewer.zip: ${central.length / 2} archivos, ${Math.round((offset + centralSize) / 1024)} KB`)
