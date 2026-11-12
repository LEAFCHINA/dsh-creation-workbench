// Live smoke test against the RUNNING DSH plugin (real host process, real data dir).
// Uses a mock ComfyUI and cleans up everything it creates.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockComfy, state as mockState } from './mock-comfy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.IW_LIVE_BASE || 'http://127.0.0.1:63577'
const workflow = JSON.parse(readFileSync(join(HERE, 'sample-workflow.json'), 'utf8'))

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  ✗ ${name}${extra ? ` :: ${extra}` : ''}`)
  }
}
function section(t) {
  console.log(`\n== ${t} ==`)
}

async function rpc(op, params = {}) {
  const res = await fetch(`${BASE}/dsh-creation-workbench/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...params }),
  })
  const payload = await res.json()
  if (!res.ok || payload.ok !== true) {
    const err = new Error(`${op} -> ${payload.error || res.status}`)
    err.code = payload.code
    throw err
  }
  return payload.data
}

const mock = await startMockComfy({ port: 18188 })
const created = { workspaceId: null, conversationId: null, workflowId: null }
const original = await rpc('settings.get')
console.log(`live plugin @ ${BASE}`)
console.log(`original comfyBaseUrl=${original.comfyBaseUrl} imageDir='${original.imageDir}'`)

try {
  section('1. 真实进程 RPC 可用')
  const pingRes = await fetch(`${BASE}/dsh-creation-workbench/ping`)
  const ping = await pingRes.json()
  section('1b. 新增 RPC')
  const taskList = await rpc('job.list')
  ok('job.list 可用', Array.isArray(taskList?.jobs), JSON.stringify(taskList)?.slice(0, 120))
  const queueSnap = await rpc('comfy.queue')
  ok('comfy.queue 可用', typeof queueSnap?.ok === 'boolean', JSON.stringify(queueSnap)?.slice(0, 120))

  ok('ping 返回新 host build', /^\d{4}-\d{2}-\d{2}-host-\d+$/.test(String(ping?.data?.build)), JSON.stringify(ping?.data?.build))

  section('2. ComfyUI 地址与连通检测')
  const saved = await rpc('settings.set', { comfyBaseUrl: mock.baseUrl })
  ok('保存地址', saved?.comfyBaseUrl === mock.baseUrl, saved?.comfyBaseUrl)
  const status = await rpc('comfy.status')
  ok('检测连通', status?.ok === true, JSON.stringify(status))

  section('3. 工作流导入与暴露参数')
  const inspection = await rpc('comfy.workflow.inspect', { json: workflow })
  ok('inspect 节点数', (inspection?.nodes || []).length >= 6, String((inspection?.nodes || []).length))
  const params = [
    { key: 'p1', nodeId: '6', inputName: 'text', label: '提示词', type: 'text', role: 'prompt' },
    { key: 'p2', nodeId: '3', inputName: 'steps', label: '步数', type: 'int', default: 20 },
    { key: 'p3', nodeId: '3', inputName: 'sampler_name', label: '采样器', type: 'select', options: ['euler', 'dpmpp_2m'], default: 'euler' },
    { key: 'p4', nodeId: '5', inputName: 'width', label: '宽', type: 'int', default: 1024 },
    { key: 'p5', nodeId: '5', inputName: 'height', label: '高', type: 'int', default: 1024 },
  ]
  const savedWf = await rpc('comfy.workflow.save', { name: '冒烟测试工作流', json: workflow, params })
  created.workflowId = savedWf?.workflow?.id || savedWf?.id
  ok('保存工作流', /^wf_/.test(created.workflowId || ''), String(created.workflowId))
  const list = await rpc('comfy.workflow.list')
  const listItem = (list?.workflows || []).find((w) => w.id === created.workflowId)
  ok('list 带 params（供 composer 渲染）', Array.isArray(listItem?.params) && listItem.params.length === 5, JSON.stringify(listItem?.params?.length))

  section('4. 真实生成链路')
  const ws = await rpc('workspace.create', { name: 'ComfyUI 冒烟' })
  created.workspaceId = ws?.id
  const conv = await rpc('conversation.create', { workspaceId: created.workspaceId, title: '冒烟会话' })
  created.conversationId = conv?.id
  ok('工作区/会话创建', Boolean(created.workspaceId && created.conversationId))

  const gen = await rpc('generate', {
    workspaceId: created.workspaceId,
    conversationId: created.conversationId,
    prompt: '冒烟：窗台上的猫',
    params: {
      model: `comfy:${created.workflowId}`,
      n: 1,
      workflowId: created.workflowId,
      workflowParams: { p2: 25, p3: 'dpmpp_2m' },
      displayName: '冒烟测试工作流',
    },
    refs: [],
  })
  ok('generate 受理', Boolean(gen?.jobId && gen?.turnId), JSON.stringify(gen)?.slice(0, 200))

  let view = null
  for (let i = 0; i < 160; i += 1) {
    view = await rpc('job.get', { jobId: gen.jobId })
    if (view && ['done', 'error', 'cancelled'].includes(view.status)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  ok('生成完成', view?.status === 'done', JSON.stringify(view))
  ok('mock 收到提示词', mockState.lastPromptBody?.prompt?.['6']?.inputs?.text === '冒烟：窗台上的猫', JSON.stringify(mockState.lastPromptBody?.prompt?.['6']?.inputs?.text))
  ok('参数覆盖生效（steps=25）', mockState.lastPromptBody?.prompt?.['3']?.inputs?.steps === 25, String(mockState.lastPromptBody?.prompt?.['3']?.inputs?.steps))

  const conversation = await rpc('conversation.get', { workspaceId: created.workspaceId, conversationId: created.conversationId })
  const turn = (conversation?.turns || []).find((t) => t.id === gen.turnId)
  const image = turn?.images?.[0]
  ok('turn 落盘图片', Boolean(image?.localPath), JSON.stringify(image?.localPath))
  if (image) {
    const fileRes = await fetch(`${BASE}${image.url}`)
    const bytes = Buffer.from(await fileRes.arrayBuffer())
    ok('/file 可回读图片', fileRes.ok && bytes.length > 0 && String(fileRes.headers.get('content-type')).startsWith('image/'), `${fileRes.status} ${bytes.length}`)
    ok('尺寸已解析', image.w > 0 && image.h > 0, `${image.w}x${image.h}`)
  }

  section('5. 错误提示可读')
  mockState.failSystemStats = true
  const bad = await rpc('comfy.status')
  ok('不可达时返回 ok:false + 中文错误', bad?.ok === false && typeof bad.error === 'string' && /ComfyUI/.test(bad.error), JSON.stringify(bad))
  mockState.failSystemStats = false
  let uiFormatRejected = false
  try {
    await rpc('comfy.workflow.inspect', { json: { nodes: [], links: [] } })
  } catch (e) {
    uiFormatRejected = /API格式|界面格式|保存/.test(e.message)
  }
  ok('UI 格式工作流给出可操作提示', uiFormatRejected)
} finally {
  // cleanup: workspace (removes its turns/images), workflow, settings
  try {
    if (created.workspaceId) await rpc('workspace.delete', { id: created.workspaceId })
  } catch (e) {
    console.log('cleanup workspace failed:', e.message)
  }
  try {
    if (created.workflowId) await rpc('comfy.workflow.delete', { id: created.workflowId })
  } catch (e) {
    console.log('cleanup workflow failed:', e.message)
  }
  try {
    const restored = await rpc('settings.set', { comfyBaseUrl: original.comfyBaseUrl, imageDir: original.imageDir })
    console.log(`restored comfyBaseUrl=${restored.comfyBaseUrl}`)
  } catch (e) {
    console.log('cleanup settings failed:', e.message)
  }
  const after = await rpc('comfy.workflow.list')
  console.log(`workflows after cleanup: ${(after?.workflows || []).length}`)
  await mock.close()
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'))
  process.exitCode = 1
}
