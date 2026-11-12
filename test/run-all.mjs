// Runs the repository test suites in sequence:
//   1. host e2e (mock ComfyUI, full generate pipeline + queue/task RPCs)
//   2. host regression (save dir, batch, cancel, API mode)
//   3. client smoke (bundle loads, module id, editor render, static wiring)
// live-smoke.mjs needs a running DSH instance and is NOT part of CI.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SUITES = ['e2e.mjs', 'e2e2.mjs', 'client-smoke.mjs']

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, file)], {
      cwd: join(HERE, '..'),
      stdio: 'inherit',
    })
    child.on('exit', (code) => resolve(code === 0))
  })
}

const results = []
for (const file of SUITES) {
  console.log(`\n===== ${file} =====`)
  results.push([file, await run(file)])
}

let failed = 0
for (const [file, ok] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}`)
  if (!ok) failed += 1
}
if (failed > 0) {
  console.error(`\n${failed} suite(s) failed`)
  process.exit(1)
}
console.log('\nall suites passed')
