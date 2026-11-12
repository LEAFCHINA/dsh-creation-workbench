// Second e2e suite: save-dir setting, multi-image, batch_size, cancel, and API-mode regression.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from './rpc-harness.mjs'
import { startMockComfy, resetState, state as mockState, PNG } from './mock-comfy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
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

// --- mock OpenAI-compatible image API ---
const openai = { promptCalls: 0, requests: [] }
const apiServer = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }))
      return
    }
    if (url.pathname === '/v1/images/generations') {
      openai.promptCalls += 1
      openai.requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
})
await new Promise((r) => apiServer.listen(18289, '127.0.0.1', r))
const apiBase = 'http://127.0.0.1:18289/v1'

const mock = await startMockComfy({ port: 18188 })
const h = await createHarness()

async function waitJob(jobId, ms = 30000) {
  const deadline = Date.now() + ms
  let view = null
  while (Date.now() < deadline) {
    view = await h.op('job.get', { jobId })
    if (view && ['done', 'error', 'cancelled'].includes(view.status)) return view
    await new Promise((r) => setTimeout(r, 200))
  }
  return view
}

try {
  section('1. 设置校验与归一化')
  const saved1 = await h.op('settings.set', { comfyBaseUrl: 'http://127.0.0.1:8188/' })
  ok('去尾斜杠', saved1?.comfyBaseUrl === 'http://127.0.0.1:8188', saved1?.comfyBaseUrl)
  let rejected = false
  try {
    await h.op('settings.set', { comfyBaseUrl: 'ftp://bad' })
  } catch (e) {
    rejected = e.status === 400
  }
  ok('非 http(s) 被拒绝', rejected)
  const saved2 = await h.op('settings.set', { comfyBaseUrl: mock.baseUrl })
  ok('保存 mock 地址', saved2?.comfyBaseUrl === mock.baseUrl)

  section('2. 素材保存目录（imageDir）生效')
  const customDir = join(process.env.DSH_HOME, 'custom-images')
  const saved3 = await h.op('settings.set', { imageDir: customDir })
  ok('保存 imageDir', saved3?.imageDir === customDir, saved3?.imageDir)

  resetState()
  const ws = await h.op('workspace.create', { name: 'save-dir' })
  const wsId = ws?.id
  const conv = await h.op('conversation.create', { workspaceId: wsId, title: 'c1' })
  const convId = conv?.id

  const wf = await h.op('comfy.workflow.save', {
    name: '存图测试',
    json: workflow,
    params: [
      { key: 'p1', nodeId: '6', inputName: 'text', label: '提示词', type: 'text', role: 'prompt' },
      { key: 'p2', nodeId: '3', inputName: 'steps', label: '步数', type: 'int', default: 20 },
    ],
  })
  const wfId = wf?.workflow?.id || wf?.id

  const gen1 = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '测试存图目录',
    params: { model: `comfy:${wfId}`, n: 1, workflowId: wfId, workflowParams: {}, displayName: '存图测试' },
    refs: [],
  })
  const view1 = await waitJob(gen1.jobId)
  ok('生成完成', view1?.status === 'done', JSON.stringify(view1))
  const convObj = await h.op('conversation.get', { workspaceId: wsId, conversationId: convId })
  const turn = (convObj?.turns || []).find((t) => t.id === gen1.turnId)
  const localPath = turn?.images?.[0]?.localPath || ''
  ok('图片写入自定义目录', localPath.startsWith(customDir), localPath)
  ok('自定义目录下确有文件', existsSync(localPath), localPath)
  ok('图片元数据名用 displayName', /存图测试/.test(String(turn?.images?.[0]?.name)), String(turn?.images?.[0]?.name))

  section('3. n=2 → 两次入队；batch_size 暴露 → 只入队一次')
  resetState()
  const gen2 = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '两张',
    params: { model: `comfy:${wfId}`, n: 2, workflowId: wfId, workflowParams: {}, displayName: '存图测试' },
    refs: [],
  })
  const view2 = await waitJob(gen2.jobId)
  ok('n=2 完成', view2?.status === 'done', JSON.stringify(view2))
  ok('n=2 入队两次', mockState.promptCalls === 2, `calls=${mockState.promptCalls}`)
  const convObj2 = await h.op('conversation.get', { workspaceId: wsId, conversationId: convId })
  const turn2 = (convObj2?.turns || []).find((t) => t.id === gen2.turnId)
  ok('n=2 得到两张图', (turn2?.images || []).length === 2, JSON.stringify((turn2?.images || []).length))

  resetState()
  const wfBatch = await h.op('comfy.workflow.save', {
    name: '批量测试',
    json: workflow,
    params: [
      { key: 'p1', nodeId: '6', inputName: 'text', label: '提示词', type: 'text', role: 'prompt' },
      { key: 'p2', nodeId: '5', inputName: 'batch_size', label: '张数', type: 'int', min: 1, max: 64, default: 1 },
    ],
  })
  const wfBatchId = wfBatch?.workflow?.id || wfBatch?.id
  const gen3 = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '批量',
    params: { model: `comfy:${wfBatchId}`, n: 3, workflowId: wfBatchId, workflowParams: {}, displayName: '批量测试' },
    refs: [],
  })
  const view3 = await waitJob(gen3.jobId)
  ok('batch_size 模式完成', view3?.status === 'done', JSON.stringify(view3))
  ok('batch_size 模式只入队一次', mockState.promptCalls === 1, `calls=${mockState.promptCalls}`)
  ok('batch_size 被设为 n=3', mockState.lastPromptBody?.prompt?.['5']?.inputs?.batch_size === 3, String(mockState.lastPromptBody?.prompt?.['5']?.inputs?.batch_size))

  section('4. 取消（ComfyUI 永不完成）')
  resetState()
  mockState.neverComplete = true
  const gen4 = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '取消测试',
    params: { model: `comfy:${wfId}`, n: 1, workflowId: wfId, workflowParams: {}, displayName: '存图测试' },
    refs: [],
  })
  await new Promise((r) => setTimeout(r, 1200))
  await h.op('job.cancel', { jobId: gen4.jobId })
  const view4 = await waitJob(gen4.jobId, 15000)
  ok('取消后终态为 cancelled', view4?.status === 'cancelled', JSON.stringify(view4))
  await new Promise((r) => setTimeout(r, 400))
  ok('取消时尝试删远端队列', mockState.queueDeleteCalls.length > 0, JSON.stringify(mockState.queueDeleteCalls))
  mockState.neverComplete = false

  section('5. 旧 API 模式回归（mock OpenAI）')
  resetState()
  await h.op('settings.set', { baseUrl: apiBase, apiKey: 'sk-test-1234567890', imageDir: '' })
  const st = await h.op('settings.get')
  ok('API Key 已配置且有掩码', st?.apiKeySet === true && String(st?.apiKeyHint).includes('…'), JSON.stringify(st?.apiKeyHint))
  const models = await h.op('models.list')
  ok('models.list 可用', Array.isArray(models?.models) && models.models.length > 0, JSON.stringify(models?.models))
  const gen5 = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: 'API 模式回归',
    params: { model: 'gpt-image-2', n: 1, size: '1024x1024', quality: 'auto' },
    refs: [],
  })
  const view5 = await waitJob(gen5.jobId)
  ok('API 模式生成成功', view5?.status === 'done', JSON.stringify(view5))
  ok('mock OpenAI 收到请求', openai.promptCalls === 1, `calls=${openai.promptCalls}`)
  const convObj3 = await h.op('conversation.get', { workspaceId: wsId, conversationId: convId })
  const turn3 = (convObj3?.turns || []).find((t) => t.id === gen5.turnId)
  ok('API 模式图片落盘', Boolean(turn3?.images?.[0]?.localPath), JSON.stringify(turn3?.images?.[0]))
  if (turn3?.images?.[0]) {
    const fileRes = await h.route(`file?id=${turn3.images[0].id}`)
    ok('API 模式 /file 可读', fileRes.status === 200 && fileRes.bytes.length > 0)
  }

  section('6. 持久化与数据文件位置')
  const wfFile = join(process.env.DSH_HOME, 'dsh-creation-workbench', 'workflows.json')
  ok('workflows.json 在 DATA_DIR', existsSync(wfFile), wfFile)
  const parsed = JSON.parse(readFileSync(wfFile, 'utf8'))
  const wl = await h.op('comfy.workflow.list')
  ok('workflows.json 与 list 一致', Array.isArray(parsed.workflows) && parsed.workflows.length === (wl?.workflows || []).length && parsed.workflows.length >= 2, `file=${parsed.workflows?.length} list=${(wl?.workflows || []).length}`)
  ok('未写入真实 ~/.dsh', !existsSync(join(process.env.DSH_HOME, 'dsh-creation-workbench', 'settings.json')) === false && process.env.DSH_HOME !== 'C:\\Users\\Yeafc\\.dsh', process.env.DSH_HOME)
  void readdirSync

  section('7. 无效工作流/参数')
  let missingSync = false
  let missingJob = null
  try {
    const g = await h.op('generate', {
      workspaceId: wsId,
      conversationId: convId,
      prompt: 'x',
      params: { model: 'comfy:wf_deadbeef', n: 1, workflowId: 'wf_deadbeef', workflowParams: {}, displayName: 'x' },
      refs: [],
    })
    missingJob = await waitJob(g.jobId, 15000)
  } catch (e) {
    missingSync = e.status === 400
  }
  ok('不存在的工作流被明确拒绝', missingSync || missingJob?.status === 'error', JSON.stringify({ missingSync, missingJob }))
  let badParam = false
  try {
    await h.op('comfy.workflow.save', {
      id: wfId,
      params: [{ key: 'p1', nodeId: '6', inputName: 'text', label: 'x', type: 'bogus' }],
    })
  } catch (e) {
    badParam = e.status === 400
  }
  ok('非法参数类型被拒绝', badParam)
} finally {
  await mock.close()
  await new Promise((r) => apiServer.close(r))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'))
  process.exitCode = 1
}
