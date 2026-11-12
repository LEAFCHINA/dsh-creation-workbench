/**
 * Host half of the AI image workbench plugin (stable entry shim).
 *
 * This entry stays deliberately thin and is NOT edited during development:
 *  - it registers the same-origin HTTP routes for the Client half
 *  - every request is served by a fresh import of `host/main.js`, so host-side
 *    logic can be updated on disk and picked up on the next request without
 *    restarting the DeepSeek Harness process.
 *
 * The real implementation lives in `host/main.js` (see CONTRACT.md).
 */

import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const API_PREFIX = '/dsh-creation-workbench/'
export const HOST_BUILD = '2026-11-11-host-shim-1'

const HOST_ENTRY = new URL('./host/main.js', import.meta.url)
const ROUTES = ['ping', 'rpc', 'file']

let logFn = () => {}

function log(message) {
  try {
    logFn(message)
  } catch {
    // ignore logger failures
  }
}

/**
 * Import the current generation of host/main.js.
 * The query string is derived from file metadata, so an edited file produces a
 * fresh ES module generation (Node caches modules by full URL).
 */
async function loadHostModule() {
  let rev = '0'
  try {
    const info = await stat(fileURLToPath(HOST_ENTRY))
    rev = `${info.mtimeMs.toString(36)}-${info.size.toString(36)}`
  } catch {
    // Fall through: import() reports the missing module below.
  }
  return import(`${HOST_ENTRY.href}?rev=${rev}`)
}

function sendJson(res, status, payload) {
  if (res.headersSent) {
    try {
      res.end()
    } catch {
      // ignore
    }
    return
  }
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function makeHandler(ctx) {
  return (req, res) => {
    Promise.resolve()
      .then(async () => {
        let host
        try {
          host = await loadHostModule()
        } catch (error) {
          log(`host module load failed: ${String(error?.stack || error)}`)
          sendJson(res, 500, { ok: false, error: `host module load failed: ${String(error?.message || error)}` })
          return
        }
        if (!host || typeof host.handle !== 'function') {
          sendJson(res, 500, { ok: false, error: 'host module does not export handle()' })
          return
        }
        await host.handle(req, res, { ctx, prefix: API_PREFIX, hostBuild: HOST_BUILD, log })
      })
      .catch((error) => {
        log(`request failed: ${String(error?.stack || error)}`)
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      })
  }
}

export function apply(ctx) {
  logFn = (message) => {
    try {
      ctx.logger?.info?.(`[creation-workbench] ${message}`)
    } catch {
      // ignore
    }
  }

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const disposers = []
      try {
        for (const name of ROUTES) {
          disposers.push(scope.webServer.register({
            kind: 'exact',
            path: `${API_PREFIX}${name}`,
            handler: makeHandler(scope),
          }))
        }
        log(`routes ready: ${ROUTES.map((name) => `${API_PREFIX}${name}`).join(', ')}`)
      } catch (error) {
        log(`route registration failed: ${String(error?.message || error)}`)
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // ignore
          }
        }
      }
    })
  })
}
