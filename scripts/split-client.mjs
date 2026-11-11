// Reconstruct client-src/*.js fragments from the prebuilt client.js bundle.
// The bundle is a plain concatenation of the fragments, each prefixed by a
// `/* ===== NN-name.js ===== */` marker; this script splits it back apart and
// then re-joins it to prove the round trip is byte-identical.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = process.argv[2] || join(HERE, '..', 'client.js')
const outDir = process.argv[3] || join(HERE, '..', 'client-src')

const text = readFileSync(source, 'utf8')
const MARKER = /\/\* ===== ([0-9A-Za-z._-]+) ===== \*\/\n/g

const matches = [...text.matchAll(MARKER)]
if (matches.length === 0) throw new Error('no fragment markers found')
if (matches[0].index !== 0) throw new Error('bundle does not start with a marker')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const fragments = []
for (let i = 0; i < matches.length; i += 1) {
  const marker = matches[i]
  const name = marker[1]
  const bodyStart = marker.index + marker[0].length
  const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : text.length
  fragments.push({ name, body: text.slice(bodyStart, bodyEnd) })
}

for (const fragment of fragments) {
  writeFileSync(join(outDir, fragment.name), fragment.body, 'utf8')
}

// Rebuild exactly like scripts/build-client.mjs does.
const rebuilt = fragments.map((f) => `/* ===== ${f.name} ===== */\n${f.body}`).join('')
if (rebuilt !== text) {
  throw new Error(`round trip mismatch: rebuilt=${rebuilt.length} original=${text.length}`)
}

console.log(`split ${fragments.length} fragments -> ${outDir}`)
for (const fragment of fragments) {
  console.log(`  ${fragment.name.padEnd(22)} ${String(fragment.body.length).padStart(7)} chars`)
}
console.log('round trip: byte-identical OK')
