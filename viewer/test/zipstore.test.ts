import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, storeZip } from '../src/lib/zipstore.ts'

assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)   // the CRC-32 check value

// a real ZIP: Python's zipfile reads it back, names (UTF-8) and bytes intact
const files = [{ name: '001.jpg', data: new Uint8Array([1, 2, 3]) }, { name: 'página 2.png', data: new Uint8Array(1000).fill(7) }]
const dir = mkdtempSync(join(tmpdir(), 'zipstore-'))
try {
  const path = join(dir, 'c.cbz')
  writeFileSync(path, storeZip(files))
  const out = execFileSync('python', ['-I', '-c', `import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps([[i.filename, len(z.read(i))] for i in z.infolist()]))`, path]).toString()
  assert.deepEqual(JSON.parse(out), [['001.jpg', 3], ['página 2.png', 1000]])
  assert.equal(readFileSync(path).readUInt32LE(0), 0x04034b50)
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log('zipstore ok')
