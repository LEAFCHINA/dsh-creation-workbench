// Build client.js from client-src/*.js fragments (filename order).
// The bundle is a classic script: it registers itself through
// window.__ModuleLoader__ and must not use import/export.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'client-src')
const OUT = join(ROOT, 'client.js')

const files = readdirSync(SRC)
  .filter((name) => name.endsWith('.js'))
  .sort()

if (files.length === 0) throw new Error('client-src/ is empty')

const parts = files.map((name) => {
  const body = readFileSync(join(SRC, name), 'utf8')
  return `/* ===== ${name} ===== */\n${body}`
})

writeFileSync(OUT, parts.join(''), 'utf8')
console.log(`built client.js from ${files.length} fragments (${readFileSync(OUT, 'utf8').length} chars)`)
