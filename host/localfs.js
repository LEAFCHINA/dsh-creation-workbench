/**
 * Local file operations (CONTRACT.md 补丁 v1.4 §A3).
 *
 * All image access is by registry imageId only — the client never supplies a
 * source path. Destination dirs for file.saveAs are validated; folder.open /
 * file.open / file.reveal are deliberately unrestricted for this single-user
 * local app, and are fired-and-forgotten so a stuck GUI never blocks a request.
 * folder.pick is the one intentionally blocking call (up to 120s by design).
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

const { ApiError, isId, truncate } = util

const PICK_TIMEOUT_MS = 120000

/* ------------------------------------------------------------------ */
/* OS helpers                                                          */
/* ------------------------------------------------------------------ */

function fireAndForget(command, args, fallback) {
  const launch = (exe, argv) => {
    const child = spawn(exe, argv, {
      detached: true,
      stdio: 'ignore',
      // CRITICAL: never set windowsHide:true here. On Windows that maps to
      // CREATE_NO_WINDOW, and GUI launchers (explorer.exe / rundll32) then
      // create their window INVISIBLY (Shell.Application finds it but
      // user32!IsWindowVisible(hwnd) is false) — that was the user-reported
      // "打开目录 button does nothing" bug. GUI windows must stay visible.
      windowsHide: false,
    })
    child.unref()
    return child
  }
  try {
    const child = launch(command, args)
    child.on('error', () => {
      // Immediate launch failure (e.g. explorer.exe missing): try the visible
      // fallback variant once, still without blocking the request.
      if (!fallback) return
      try {
        launch(fallback.command, fallback.args)
      } catch {
        // ignore
      }
    })
    return true
  } catch {
    return false
  }
}

function openWithDefaultApp(target) {
  if (process.platform === 'win32') {
    // rundll32 url.dll,FileProtocolHandler is the classic "ShellExecute" call.
    return fireAndForget('rundll32.exe', ['url.dll,FileProtocolHandler', target])
  }
  if (process.platform === 'darwin') return fireAndForget('open', [target])
  return fireAndForget('xdg-open', [target])
}

function revealInExplorer(target) {
  if (process.platform === 'win32') {
    // IMPORTANT: pass `/select,` and the path as TWO arguments. Node quotes an
    // argument containing spaces, so a single `/select,<path with spaces>`
    // token arrives as `"/select,C:\a b\c.png"` and explorer silently ignores
    // it (no window). Two args produce `/select, "C:\a b\c.png"` which works.
    return fireAndForget('explorer.exe', ['/select,', target], {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', path.dirname(target)],
    })
  }
  if (process.platform === 'darwin') return fireAndForget('open', ['-R', target])
  return fireAndForget('xdg-open', [path.dirname(target)])
}

function openDirectory(dir) {
  if (process.platform === 'win32') {
    return fireAndForget('explorer.exe', [dir], {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', dir],
    })
  }
  if (process.platform === 'darwin') return fireAndForget('open', [dir])
  return fireAndForget('xdg-open', [dir])
}

function assertImageId(imageId) {
  if (!isId(imageId, 'img') && !isId(imageId, 'up')) {
    throw new ApiError('图片 ID 无效', 'INVALID_REQUEST', 400)
  }
  return imageId
}

async function imageEntryOrThrow(imageId, label = '图片') {
  assertImageId(imageId)
  const entry = await store.lookupImageFile(imageId)
  if (!entry) throw new ApiError(`${label}不存在或已被删除`, 'INVALID_REQUEST', 404)
  return entry
}

async function ensureFileExists(entry, label = '图片文件') {
  try {
    const info = await fs.stat(entry.path)
    if (info.isFile()) return info
  } catch {
    // fall through
  }
  throw new ApiError(`${label}已不存在（可能已被删除）`, 'INVALID_REQUEST', 404)
}

/* ------------------------------------------------------------------ */
/* RPC implementations                                                 */
/* ------------------------------------------------------------------ */

/**
 * Encoding-proof folder picker script (ASCII-ONLY file; all Unicode values are
 * passed through ENV vars and written to the output file as UTF-8 without BOM,
 * then read by Node as UTF-8 — stdout is never parsed for the path).
 * DSH_IW_PICK_TEST is only used by the internal automation hook.
 */
const PICK_SCRIPT_ASCII = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
  '$out = [string]$env:DSH_IW_PICK_OUT',
  '$utf8 = New-Object System.Text.UTF8Encoding($false)',
  '$test = $env:DSH_IW_PICK_TEST',
  'if ($null -ne $test) {',
  '  [IO.File]::WriteAllText($out, [string]$test, $utf8)',
  '  exit 0',
  '}',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$title = [string]$env:DSH_IW_PICK_TITLE',
  'if (-not [string]::IsNullOrEmpty($title)) { $dialog.Description = $title }',
  '$dialog.ShowNewFolderButton = $true',
  '$initial = [string]$env:DSH_IW_PICK_INITIAL',
  'if (-not [string]::IsNullOrEmpty($initial) -and (Test-Path -LiteralPath $initial)) {',
  '  $dialog.SelectedPath = $initial',
  '}',
  '$result = $dialog.ShowDialog()',
  'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $path = [string]$dialog.SelectedPath } else { $path = "" }',
  '[IO.File]::WriteAllText($out, $path, $utf8)',
].join('\n')

/**
 * folder.pick {title?, initial?, testValue?} → {path} | {path:null}.
 *
 * testValue is an internal automation hook: it skips the GUI dialog and
 * round-trips that exact string through the same PowerShell UTF-8 write →
 * Node UTF-8 read path (used by QA to verify Chinese paths without a GUI).
 */
export async function pickFolder({ title, initial, testValue } = {}) {
  if (process.platform !== 'win32') {
    throw new ApiError('当前系统不支持系统目录选择，请手动填写绝对路径', 'INVALID_REQUEST', 400)
  }
  const hasTestValue = testValue !== undefined && testValue !== null
  if (hasTestValue && typeof testValue !== 'string') {
    throw new ApiError('testValue 必须是字符串', 'INVALID_REQUEST', 400)
  }
  const safeTitle = String(title == null ? '' : title).slice(0, 120)
  const safeInitial = String(initial == null ? '' : initial).slice(0, 500)
  const tempRoot = path.join(os.tmpdir(), `dsh-iw-folder-pick-${randomUUID().slice(0, 8)}`)
  const scriptFile = path.join(tempRoot, 'pick.ps1')
  const outFile = path.join(tempRoot, 'pick.out')
  try {
    await fs.mkdir(tempRoot, { recursive: true })
    await fs.writeFile(scriptFile, PICK_SCRIPT_ASCII, 'ascii')
    await fs.writeFile(outFile, '', 'utf8')
    const childEnv = {
      ...process.env,
      DSH_IW_PICK_OUT: outFile,
      DSH_IW_PICK_TITLE: safeTitle,
      DSH_IW_PICK_INITIAL: safeInitial,
    }
    if (hasTestValue) childEnv.DSH_IW_PICK_TEST = testValue
    await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
        { timeout: PICK_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, env: childEnv },
        (error) => {
          if (error) {
            const timedOut = error.killed === true
            const reason = truncate(String(error?.message || error), 160)
            reject(
              new ApiError(
                timedOut ? '目录选择框超时（120 秒），请手动填写路径' : `无法打开目录选择框：${reason}`,
                'INVALID_REQUEST',
                400,
              ),
            )
            return
          }
          resolve()
        },
      )
    })
    // The chosen path comes from the UTF-8 output file, never from stdout.
    let picked = ''
    try {
      picked = await fs.readFile(outFile, 'utf8')
    } catch {
      picked = ''
    }
    // Strip a UTF-8 BOM defensively (script writes no BOM, but be tolerant).
    if (picked.charCodeAt(0) === 0xfeff) picked = picked.slice(1)
    return { path: picked === '' ? null : picked }
  } finally {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

/** folder.open {path?} → {ok,path} (defaults to settings.imageDir). */
export async function openFolder({ path: requested } = {}) {
  let target
  if (requested === undefined || requested === null || requested === '') {
    target = await store.resolveImageDir()
    await fs.mkdir(target, { recursive: true })
  } else {
    if (typeof requested !== 'string') {
      throw new ApiError('目录路径必须是字符串', 'INVALID_REQUEST', 400)
    }
    target = requested.trim()
    if (!target) {
      target = await store.resolveImageDir()
      await fs.mkdir(target, { recursive: true })
    } else if (!path.isAbsolute(target)) {
      throw new ApiError('目录路径必须是绝对路径', 'INVALID_REQUEST', 400)
    }
  }
  let info
  try {
    info = await fs.stat(target)
  } catch {
    throw new ApiError(`目录不存在：${truncate(target, 200)}`, 'INVALID_REQUEST', 404)
  }
  if (!info.isDirectory()) throw new ApiError(`不是目录：${truncate(target, 200)}`, 'INVALID_REQUEST', 400)
  openDirectory(target)
  return { ok: true, path: target }
}

/** file.open {imageId} → {ok,path}: opens the image with the default app. */
export async function openImage({ imageId } = {}) {
  const entry = await imageEntryOrThrow(imageId)
  await ensureFileExists(entry)
  openWithDefaultApp(entry.path)
  return { ok: true, path: entry.path }
}

/** file.reveal {imageId} → {ok,path}: opens Explorer with the file selected. */
export async function revealImage({ imageId } = {}) {
  const entry = await imageEntryOrThrow(imageId)
  await ensureFileExists(entry)
  revealInExplorer(entry.path)
  return { ok: true, path: entry.path }
}

function safeFileName(entry) {
  let base = String(entry.name || '').trim()
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '')
  if (!base) {
    const extMatch = /\.([a-z0-9]+)$/i.exec(String(entry.path || ''))
    base = `image.${extMatch ? extMatch[1] : 'png'}`
  }
  return base.slice(0, 160)
}

function splitName(name) {
  const ext = path.extname(name)
  return { stem: ext ? name.slice(0, -ext.length) : name, ext }
}

async function uniqueTargetPath(dir, fileName) {
  const { stem, ext } = splitName(fileName)
  let candidate = path.join(dir, fileName)
  let index = 2
  for (;;) {
    try {
      await fs.access(candidate)
      candidate = path.join(dir, `${stem} (${index})${ext}`)
      index += 1
      if (index > 500) {
        throw new ApiError('目标目录中同名文件过多，请更换目录', 'INVALID_REQUEST', 400)
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return candidate
      throw error
    }
  }
}

/** file.saveAs {imageId, dir?} → {path,bytes}: copies a registered image. */
export async function saveImageAs({ imageId, dir } = {}) {
  const entry = await imageEntryOrThrow(imageId)
  const info = await ensureFileExists(entry)
  let targetDir
  if (dir === undefined || dir === null || dir === '') {
    targetDir = await store.resolveSaveDir()
  } else {
    targetDir = await store.validateDirectorySetting(dir, '另存为目录')
  }
  await fs.mkdir(targetDir, { recursive: true })
  const target = await uniqueTargetPath(targetDir, safeFileName(entry))
  try {
    await fs.copyFile(entry.path, target)
  } catch (error) {
    throw new ApiError(
      `另存图片失败：${truncate(String(error?.message || error), 160)}`,
      'INVALID_REQUEST',
      400,
    )
  }
  return { path: target, bytes: Number(entry.bytes) || info.size }
}
