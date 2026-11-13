/**
 * v3.0: link an ✨ agent template to a REAL DSH workspace + session.
 *
 * The plugin keeps its own chat view (so nothing breaks), but every agent
 * conversation also registers itself in the software's own workspace list:
 *
 *   <directory of an existing DSH workspace>/创作工作台临时会话/
 *
 * with one DSH session per template, so the session shows up in the DSH sidebar
 * and its data is associated with the template. This module NEVER navigates the
 * UI and never touches the plugin's own conversation files.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

const { ApiError, nowIso, isPlainObject } = util

export const LINK_WORKSPACE_TITLE = '创作工作台临时会话'
const LINKS_FILE = () => path.join(store.dataDir(), 'agent-links.json')

async function readLinks() {
  const raw = await store.readJsonFile(LINKS_FILE(), null)
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isPlainObject(value)) continue
    if (typeof value.sessionId !== 'string' || !value.sessionId) continue
    out[key] = {
      sessionId: value.sessionId,
      workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : '',
      templateName: typeof value.templateName === 'string' ? value.templateName : '',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    }
  }
  return out
}

async function writeLinks(links) {
  await store.writeJsonAtomic(LINKS_FILE(), links)
}

function getService(ctx, name) {
  try {
    if (!ctx) return null
    return typeof ctx.get === 'function' ? ctx.get(name) || null : ctx[name] || null
  } catch {
    return null
  }
}

/** Best-effort discovery of the directory that hosts the user's DSH workspaces. */
async function resolveWorkspaceBase(registry) {
  const candidates = []
  try {
    if (registry && typeof registry.list === 'function') {
      const list = await registry.list()
      for (const item of Array.isArray(list) ? list : []) {
        const dir =
          (item && item.record && item.record.path) || (item && item.path) || ''
        if (typeof dir === 'string' && dir) candidates.push(dir)
      }
    }
  } catch {
    // registry listing is best effort
  }
  for (const dir of candidates) {
    try {
      const info = await fs.stat(dir)
      if (info.isDirectory()) return path.dirname(dir)
    } catch {
      // try the next candidate
    }
  }
  return path.join(os.homedir(), '.dsh', 'workspaces')
}

/**
 * Ensure the linked DSH session for one template.
 * Returns `{ ok, sessionId, workspacePath, reusable }`.
 */
export async function ensureDshSession(ctx, { templateId, templateName } = {}) {
  const id = typeof templateId === 'string' ? templateId : ''
  if (!id) throw new ApiError('模板 ID 无效', 'INVALID_REQUEST', 400)
  const links = await readLinks()
  const existing = links[id]
  if (existing) {
    return { ok: true, sessionId: existing.sessionId, workspacePath: existing.workspacePath, reusable: true }
  }
  const registry = getService(ctx, 'workspaceRegistry')
  const sessions = getService(ctx, 'sessions')
  if (!registry || !sessions) {
    return {
      ok: false,
      error: '当前环境不支持 DSH 工作区/会话（仅桌面端可用）',
      sessionId: '',
      workspacePath: '',
    }
  }
  const base = await resolveWorkspaceBase(registry)
  const folder = path.join(base, LINK_WORKSPACE_TITLE)
  try {
    await fs.mkdir(folder, { recursive: true })
  } catch (error) {
    return { ok: false, error: `无法创建目录：${String(error?.message || error)}`, sessionId: '', workspacePath: folder }
  }
  try {
    if (typeof registry.create === 'function') {
      await registry.create(folder, LINK_WORKSPACE_TITLE)
    }
  } catch (error) {
    return {
      ok: false,
      error: `无法登记 DSH 工作区：${String(error?.message || error)}`,
      sessionId: '',
      workspacePath: folder,
    }
  }
  let session = null
  try {
    session = await sessions.create(undefined, { meta: { cwd: folder } })
  } catch (error) {
    return {
      ok: false,
      error: `无法创建 DSH 会话：${String(error?.message || error)}`,
      sessionId: '',
      workspacePath: folder,
    }
  }
  const sessionId = session && typeof session.id === 'string' ? session.id : ''
  if (!sessionId) {
    return { ok: false, error: 'DSH 会话创建后没有返回 id', sessionId: '', workspacePath: folder }
  }
  links[id] = {
    sessionId,
    workspacePath: folder,
    templateName: typeof templateName === 'string' ? templateName.slice(0, 100) : '',
    createdAt: nowIso(),
  }
  try {
    await writeLinks(links)
  } catch {
    // the link file is advisory; the session itself already exists
  }
  void store
    .logHost(`dsh link template=${id} session=${sessionId} dir=${folder}`)
    .catch(() => {})
  return { ok: true, sessionId, workspacePath: folder, reusable: false }
}

/** Read the link recorded for one template (or all of them). */
export async function listDshLinks(ctx, { templateId } = {}) {
  const links = await readLinks()
  if (typeof templateId === 'string' && templateId) {
    return { link: links[templateId] || null }
  }
  return { links }
}
