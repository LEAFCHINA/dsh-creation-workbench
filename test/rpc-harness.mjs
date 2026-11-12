// Standalone RPC harness: loads the plugin host module directly (no DSH process needed).
// Usage:  const h = await createHarness();  await h.op('bootstrap');  await h.route('/dsh-creation-workbench/file?id=img_...')
import { Readable } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = process.env.IW_PLUGIN_DIR || join(HERE, '..')
const PREFIX = '/dsh-creation-workbench/'

export async function createHarness({ dataHome } = {}) {
  // Always isolate test data unless explicitly asked to use the real DSH_HOME.
  if (process.env.IW_USE_REAL_HOME !== '1') {
    process.env.DSH_HOME = dataHome || mkdtempSync(join(tmpdir(), 'iw-dsh-home-'))
  }
  const mainUrl = pathToFileURL(join(PLUGIN_DIR, 'host', 'main.js')).href
  const host = await import(mainUrl)

  const logs = []
  const env = {
    ctx: undefined,
    prefix: PREFIX,
    hostBuild: 'standalone-harness',
    log: (m) => logs.push(String(m)),
  }

  async function dispatch({ method = 'POST', url = `${PREFIX}rpc`, headers = {}, body }) {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const req = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : [])
    req.method = method
    req.url = url
    req.headers = headers
    const out = { statusCode: 200, headers: {}, body: Buffer.alloc(0) }
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader(k, v) {
        out.headers[String(k).toLowerCase()] = v
      },
      end(chunk) {
        this.headersSent = true
        if (chunk !== undefined && chunk !== null) {
          out.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
        }
      },
    }
    await host.handle(req, res, env)
    out.statusCode = res.statusCode
    const text = out.body.toString('utf8')
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      // not json
    }
    return { status: out.statusCode, headers: out.headers, json, bytes: out.body, text }
  }

  async function op(opName, params = {}) {
    const r = await dispatch({ body: { op: opName, ...params } })
    if (r.status !== 200) {
      const err = new Error(`rpc ${opName} -> HTTP ${r.status}: ${r.json?.error || r.text.slice(0, 200)}`)
      err.status = r.status
      err.payload = r.json
      throw err
    }
    if (r.json && r.json.ok === false) {
      const err = new Error(`rpc ${opName} -> ${r.json.error}`)
      err.code = r.json.code
      err.payload = r.json
      throw err
    }
    return r.json ? r.json.data : null
  }

  async function route(path) {
    return dispatch({ method: 'GET', url: `${PREFIX}${path}` })
  }

  async function ping() {
    return dispatch({ method: 'GET', url: `${PREFIX}ping` })
  }

  return { host, env, logs, op, route, ping, dispatch, pluginDir: PLUGIN_DIR, prefix: PREFIX }
}
