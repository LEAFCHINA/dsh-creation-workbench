/**
 * v3.0.1: one-time rollback of the v3.0.0 DSH workspace/session linkage.
 *
 * v3.0.0 created a real DSH workspace directory named 创作工作台临时会话 plus one
 * empty session per agent template. That added a second concept without any real
 * benefit (the plugin's own agent conversation already carries the context), so
 * the feature is removed. This module cleans up what was created:
 *
 *  - unregister the workspace from the host registry (workspaceRegistry.deleteKnown)
 *  - delete the directory when it is empty
 *  - delete the plugin's agent-links.json
 *
 * It runs once from bootstrap and is a no-op when there is nothing to clean.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

const { isPlainObject } = util

export const LINK_WORKSPACE_TITLE = '创作工作台临时会话'

function linksFile() {
  return path.join(store.dataDir(), 'agent-links.json')
}

function getService(ctx, name) {
  try {
    if (!ctx) return null
    return typeof ctx.get === 'function' ? ctx.get(name) || null : ctx[name] || null
  } catch {
    return null
  }
}

async function removeEmptyDir(dir) {
  try {
    const entries = await fs.readdir(dir)
    if (entries.length > 0) return false
    await fs.rmdir(dir)
    return true
  } catch {
    return false
  }
}

/**
 * Remove everything v3.0.0 created. Never throws: rollback must not break boot.
 * Returns `{ cleaned, workspaces, dirs, error }`.
 */
export async function rollbackDshLinks(ctx) {
  const result = { cleaned: false, workspaces: 0, dirs: 0, error: '' }
  let raw = null
  try {
    raw = await store.readJsonFile(linksFile(), null)
  } catch {
    raw = null
  }
  if (!isPlainObject(raw)) return result
  const paths = new Set()
  for (const value of Object.values(raw)) {
    if (isPlainObject(value) && typeof value.workspacePath === 'string' && value.workspacePath) {
      paths.add(value.workspacePath)
    }
  }
  const registry = getService(ctx, 'workspaceRegistry')
  if (registry) {
    try {
      const list = typeof registry.list === 'function' ? await registry.list() : []
      for (const entity of Array.isArray(list) ? list : []) {
        const dir =
          (entity && entity.record && entity.record.path) || (entity && entity.path) || ''
        if (!dir || !paths.has(dir)) continue
        try {
          if (typeof registry.deleteKnown === 'function' && typeof entity.id === 'string') {
            await registry.deleteKnown(entity.id)
            result.workspaces += 1
          }
        } catch {
          // a failed unregister must not block the rest of the cleanup
        }
      }
    } catch {
      // registry listing is best effort
    }
  }
  for (const dir of paths) {
    if (await removeEmptyDir(dir)) result.dirs += 1
  }
  try {
    await fs.rm(linksFile(), { force: true })
    result.cleaned = true
  } catch (error) {
    result.error = String(error?.message || error)
  }
  void store
    .logHost(
      `rollback v3.0 dsh links: workspaces=${result.workspaces} dirs=${result.dirs} error=${result.error || '-'}`,
    )
    .catch(() => {})
  return result
}
