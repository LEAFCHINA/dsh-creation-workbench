// Repository checks that run in CI and before publishing:
//  1. client.js is up to date with client-src/
//  2. every JavaScript file parses
//  3. package.json declares the installable dsh.bundle manifest
//  4. cordis.patch.yml points at this package name
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const problems = []

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

// 1. build freshness
const before = readFileSync(join(ROOT, 'client.js'), 'utf8')
execFileSync(process.execPath, [join(HERE, 'build-client.mjs')], { cwd: ROOT, stdio: 'pipe' })
const after = readFileSync(join(ROOT, 'client.js'), 'utf8')
if (before !== after) problems.push('client.js is stale: run `npm run build:client` and commit the result')

// 2. syntax — the fragments in client-src/ are not standalone modules (the
// header opens the module-loader call and the footer closes it), so the built
// client.js is what gets parsed here; fragment consistency is covered by the
// build-freshness check above.
const jsFiles = [
  join(ROOT, 'index.js'),
  join(ROOT, 'client.js'),
  ...walk(join(ROOT, 'host')).filter((file) => file.endsWith('.js')),
  ...walk(join(ROOT, 'scripts')).filter((file) => file.endsWith('.js')),
]
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    problems.push(`syntax error: ${file.replace(ROOT, '.')} ${String(error.stderr || error.message).split('\n')[0]}`)
  }
}

// 3. dsh manifest
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
if (!pkg.dsh || !pkg.dsh.bundle || !pkg.dsh.bundle.patch) {
  problems.push('package.json is missing dsh.bundle.patch (required to be installable)')
}
if (pkg.private === true) problems.push('package.json still has "private": true (cannot be published)')
if (!pkg.engines || !pkg.engines.dsh) problems.push('package.json should declare engines.dsh for host compatibility')

// 4. patch file name must match the package name
const patch = readFileSync(join(ROOT, pkg.dsh.bundle.patch.replace(/^\.\//, '')), 'utf8')
if (!patch.includes(`name: ${pkg.name}`) && !patch.includes(`name: '${pkg.name}'`) && !patch.includes(`name: "${pkg.name}"`)) {
  problems.push(`cordis.patch.yml does not reference package name "${pkg.name}"`)
}

if (problems.length > 0) {
  console.error('checks failed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`checks passed: ${jsFiles.length} JS files, dsh.bundle declared, client.js fresh`)
