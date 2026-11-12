// End-to-end test for the ComfyUI workflow mode (host side).
// Run: node e2e.mjs      (exits non-zero on failure)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from './rpc-harness.mjs'
import { startMockComfy, resetState, state as mockState } from './mock-comfy.mjs'

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

const mock = await startMockComfy({ port: 18188 })
const h = await createHarness()

try {
  section('0. 基础兼容（未配置 ComfyUI）')
  const ping = await h.ping()
  ok('ping 路由', ping.status === 200 && ping.json?.ok === true, JSON.stringify(ping.json))
  const boot = await h.op('bootstrap')
  ok('bootstrap 返回工作区', Boolean(boot), JSON.stringify(boot)?.slice(0, 200))
  const before = await h.op('settings.get')
  ok('settings.get 不因 comfy 字段报错', Boolean(before))
  ok('settings 带 comfyBaseUrl 字段', 'comfyBaseUrl' in (before || {}), JSON.stringify(Object.keys(before || {})))
  ok('模型列表兼容', Array.isArray(before?.models))

  section('1. 设置 comfyBaseUrl 并检测')
  const saved = await h.op('settings.set', { comfyBaseUrl: mock.baseUrl })
  ok('保存 comfyBaseUrl', saved?.comfyBaseUrl === mock.baseUrl, JSON.stringify(saved?.comfyBaseUrl))
  const status = await h.op('comfy.status')
  ok('comfy.status 连通', status?.ok === true, JSON.stringify(status))

  section('2. 工作流解析 / 保存 / 读取')
  const inspected = await h.op('comfy.workflow.inspect', { json: workflow })
  const nodes = inspected?.nodes || []
  ok('inspect 返回节点', nodes.length >= 6, `nodes=${nodes.length}`)
  const flat = nodes.flatMap((n) => (n.inputs || []).map((i) => ({ ...i, nodeId: n.nodeId, classType: n.classType })))
  ok('跳过连线输入（数组）', !flat.some((i) => i.inputName === 'model' || i.inputName === 'positive'), JSON.stringify(flat.map((f) => f.inputName)))
  ok('KSampler.sampler_name 推断为 select', flat.some((i) => i.inputName === 'sampler_name' && i.type === 'select'))
  ok('KSampler.seed 推断为 int', flat.some((i) => i.inputName === 'seed' && i.type === 'int'))
  ok('cfg 推断为 float', flat.some((i) => i.inputName === 'cfg' && i.type === 'float'))
  ok('CLIPTextEncode.text 建议为 prompt', (inspected?.suggestedParams || []).some((p) => p.role === 'prompt'), JSON.stringify(inspected?.suggestedParams))
  ok('有 outputs 提示', Array.isArray(inspected?.outputs) && inspected.outputs.length > 0, JSON.stringify(inspected?.outputs))
  ok('inspect 建议分类为 image', inspected?.suggestedCategory === 'image', JSON.stringify(inspected?.suggestedCategory))

  const params = [
    { key: 'p1', nodeId: '6', inputName: 'text', label: '正向提示词', type: 'text', role: 'prompt' },
    { key: 'p2', nodeId: '7', inputName: 'text', label: '负向提示词', type: 'text', role: 'normal', default: 'blurry' },
    { key: 'p3', nodeId: '3', inputName: 'steps', label: '步数', type: 'int', min: 1, max: 100, step: 1, default: 20 },
    { key: 'p4', nodeId: '3', inputName: 'cfg', label: 'CFG', type: 'float', min: 0, max: 30, step: 0.1, default: 7.5 },
    { key: 'p5', nodeId: '3', inputName: 'sampler_name', label: '采样器', type: 'select', options: ['euler', 'dpmpp_2m'], default: 'euler' },
    { key: 'p6', nodeId: '5', inputName: 'width', label: '宽度', type: 'int', min: 64, max: 2048, step: 8, default: 1024 },
    { key: 'p7', nodeId: '5', inputName: 'height', label: '高度', type: 'int', min: 64, max: 2048, step: 8, default: 1024 },
    { key: 'p8', nodeId: '3', inputName: 'seed', label: '种子', type: 'int', randomize: true, default: 1 },
  ]
  const created = await h.op('comfy.workflow.save', { name: '测试工作流', json: workflow, params })
  const wfId = created?.workflow?.id || created?.id
  ok('save 返回工作流 id', typeof wfId === 'string' && wfId.startsWith('wf_'), JSON.stringify(created))
  const list = await h.op('comfy.workflow.list')
  const listItems = list?.workflows || list || []
  ok('list 含新工作流', listItems.some((w) => w.id === wfId), JSON.stringify(listItems))
  ok('list 不回传 raw json', listItems.every((w) => w.json === undefined))
  const got = await h.op('comfy.workflow.get', { id: wfId })
  const gotWf = got?.workflow || got
  ok('get 返回 json 与 params', Boolean(gotWf?.json) && gotWf?.params?.length === params.length, `params=${gotWf?.params?.length}`)

  // v2.1: workflow categories (preset + custom) round-trip through list/get.
  const videoSaved = await h.op('comfy.workflow.save', {
    name: '视频测试工作流',
    category: 'video',
    json: workflow,
    params: [],
  })
  const videoId = videoSaved?.workflow?.id
  const listAfterCategory = await h.op('comfy.workflow.list')
  const videoItem = (listAfterCategory?.workflows || []).find((item) => item.id === videoId)
  ok('category 随保存生效', videoItem?.category === 'video', JSON.stringify(videoItem))
  const customSaved = await h.op('comfy.workflow.save', {
    name: '自定义分类工作流',
    category: '3D 场景',
    json: workflow,
    params: [],
  })
  const customId = customSaved?.workflow?.id
  const customGot = await h.op('comfy.workflow.get', { id: customId })
  ok('自定义分类原样保留', customGot?.workflow?.category === '3D 场景', JSON.stringify(customGot?.workflow?.category))
  await h.op('comfy.workflow.delete', { id: videoId })
  await h.op('comfy.workflow.delete', { id: customId })
  const afterCleanup = await h.op('comfy.workflow.list')
  ok('分类测试工作流已清理', (afterCleanup?.workflows || []).length === 1, JSON.stringify((afterCleanup?.workflows || []).length))

  section('3. 非法工作流拒绝')
  let rejected = false
  try {
    await h.op('comfy.workflow.inspect', { json: { nodes: [{ id: 1 }], links: [] } })
  } catch (e) {
    rejected = e.status === 400 || e.code === 'INVALID_REQUEST'
  }
  ok('UI 格式工作流被拒绝', rejected)

  section('4. 生成端到端（mock ComfyUI）')
  resetState()
  const ws = await h.op('workspace.create', { name: 'e2e' })
  const wsId = ws?.workspace?.id || ws?.id
  const conv = await h.op('conversation.create', { workspaceId: wsId, title: 't' })
  const convId = conv?.conversation?.id || conv?.id
  ok('工作区/会话创建', Boolean(wsId && convId))

  const gen = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '一只在窗台上晒太阳的猫，金色时刻',
    params: {
      model: `comfy:${wfId}`,
      n: 1,
      workflowId: wfId,
      workflowParams: { p3: 30, p4: 6.5, p5: 'euler', p6: 1024, p7: 1024, p8: 42 },
      displayName: '测试工作流',
    },
    refs: [],
  })
  const jobId = gen?.jobId
  ok('generate 返回 jobId', typeof jobId === 'string', JSON.stringify(gen))

  let view = null
  for (let i = 0; i < 120; i += 1) {
    view = await h.op('job.get', { jobId })
    if (view && ['done', 'error', 'cancelled'].includes(view.status)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  ok('任务终态为 done', view?.status === 'done', JSON.stringify(view))
  ok('mock 收到 /prompt', mockState.promptCalls > 0, `calls=${mockState.promptCalls}`)

  const sent = mockState.lastPromptBody?.prompt || {}
  ok('提示词写入正向节点 6.text', sent['6']?.inputs?.text === '一只在窗台上晒太阳的猫，金色时刻', JSON.stringify(sent['6']?.inputs?.text))
  ok('负向提示词用默认值', sent['7']?.inputs?.text === 'blurry', JSON.stringify(sent['7']?.inputs?.text))
  ok('steps 用覆盖值 30', sent['3']?.inputs?.steps === 30, String(sent['3']?.inputs?.steps))
  ok('cfg 用覆盖值 6.5', sent['3']?.inputs?.cfg === 6.5, String(sent['3']?.inputs?.cfg))
  ok('sampler_name 覆盖', sent['3']?.inputs?.sampler_name === 'euler', String(sent['3']?.inputs?.sampler_name))
  ok('seed 随机化后 != 原值 123456789', sent['3']?.inputs?.seed !== 123456789, String(sent['3']?.inputs?.seed))
  void inspected

  const conversation = await h.op('conversation.get', { workspaceId: wsId, conversationId: convId })
  const convObj = conversation?.conversation || conversation
  const turn = (convObj?.turns || []).find((t) => t.id === gen?.turnId)
  ok('turn 有图片', Array.isArray(turn?.images) && turn.images.length > 0, JSON.stringify(turn?.images))
  const img = turn?.images?.[0]
  if (img) {
    ok('图片有本地路径与尺寸', Boolean(img.localPath) && img.w > 0 && img.h > 0, JSON.stringify(img))
    const fileRes = await h.route(`file?id=${img.id}`)
    ok('file 路由可回读图片', fileRes.status === 200 && fileRes.bytes.length > 0 && String(fileRes.headers['content-type']).startsWith('image/'))
  }

  section('4b. 随机参数：按次覆盖 + 回传实际取值')
  ok(
    'job.get 回传本次随机取值（seed）',
    Boolean(view && view.randomValues && typeof view.randomValues.p8 === 'number'),
    JSON.stringify(view && view.randomValues),
  )

  const waitDone = async (jobId) => {
    let result = null
    for (let i = 0; i < 120; i += 1) {
      result = await h.op('job.get', { jobId })
      if (result && ['done', 'error', 'cancelled'].includes(result.status)) return result
      await new Promise((r) => setTimeout(r, 250))
    }
    return result
  }

  // Randomize OFF for a spec that defaults to random (seed p8): the provided
  // value must be used verbatim.
  resetState()
  const genFixed = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '固定种子',
    params: {
      model: `comfy:${wfId}`,
      n: 1,
      workflowId: wfId,
      workflowParams: { p3: 30, p8: 777 },
      workflowRandomize: { p8: false },
      displayName: '测试工作流',
    },
    refs: [],
  })
  const viewFixed = await waitDone(genFixed.jobId)
  ok('取消随机后任务完成', viewFixed?.status === 'done', JSON.stringify(viewFixed))
  ok('取消随机后 seed 使用指定值 777', mockState.lastPromptBody?.prompt?.['3']?.inputs?.seed === 777, String(mockState.lastPromptBody?.prompt?.['3']?.inputs?.seed))
  ok('取消随机后不回传该值', !viewFixed?.randomValues, JSON.stringify(viewFixed?.randomValues))

  // Randomize ON for a spec that is normally fixed (steps p3): a random value
  // must be drawn (different from the provided 30) and reported back.
  resetState()
  const genRandomSteps = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '随机步数',
    params: {
      model: `comfy:${wfId}`,
      n: 1,
      workflowId: wfId,
      workflowParams: { p3: 30, p8: 777 },
      workflowRandomize: { p3: true, p8: false },
      displayName: '测试工作流',
    },
    refs: [],
  })
  const viewRandomSteps = await waitDone(genRandomSteps.jobId)
  const sentSteps = mockState.lastPromptBody?.prompt?.['3']?.inputs?.steps
  ok('开启随机后任务完成', viewRandomSteps?.status === 'done', JSON.stringify(viewRandomSteps))
  ok('开启随机后 steps 变为随机值', sentSteps !== 30 && Number.isInteger(sentSteps), String(sentSteps))
  ok('开启随机后回传 steps 取值', viewRandomSteps?.randomValues?.p3 === sentSteps, JSON.stringify(viewRandomSteps?.randomValues))
  ok('未开启随机的 seed 仍用指定值', mockState.lastPromptBody?.prompt?.['3']?.inputs?.seed === 777, String(mockState.lastPromptBody?.prompt?.['3']?.inputs?.seed))

  section('4c. model 前缀优先于过期 workflowId')
  const workflowB = JSON.parse(JSON.stringify(workflow))
  workflowB['3'].inputs.steps = 11
  workflowB['9'].inputs.filename_prefix = 'B'
  const savedB = await h.op('comfy.workflow.save', {
    name: '测试工作流B',
    json: workflowB,
    params: [
      { key: 'p1', nodeId: '6', inputName: 'text', label: '提示词', type: 'text', role: 'prompt' },
    ],
  })
  const wfBId = savedB?.workflow?.id || savedB?.id
  ok('保存工作流B', /^wf_/.test(wfBId || ''), String(wfBId))
  resetState()
  const genStale = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: 'B 的图',
    params: {
      model: `comfy:${wfBId}`,
      n: 1,
      workflowId: wfId, // stale id belonging to workflow A
      workflowParams: {},
      displayName: 'B',
    },
    refs: [],
  })
  const viewStale = await waitDone(genStale.jobId)
  ok('过期 workflowId 的请求仍完成', viewStale?.status === 'done', JSON.stringify(viewStale))
  ok(
    '实际执行的是 model 指向的 B（steps=11）',
    mockState.lastPromptBody?.prompt?.['3']?.inputs?.steps === 11,
    String(mockState.lastPromptBody?.prompt?.['3']?.inputs?.steps),
  )
  const convAfterB = await h.op('conversation.get', { workspaceId: wsId, conversationId: convId })
  const turnB = (convAfterB?.turns || []).find((t) => t.id === genStale.turnId)
  ok('turn 记录的工作流为 B', turnB?.params?.workflowId === wfBId, JSON.stringify(turnB?.params?.workflowId))

  section('4d. 队列与跨会话任务列表')
  resetState()
  const queueInfo = await h.op('comfy.queue')
  ok(
    'comfy.queue 可用',
    queueInfo?.ok === true && Array.isArray(queueInfo.running) && Array.isArray(queueInfo.pending),
    JSON.stringify(queueInfo),
  )
  mockState.neverComplete = true
  const genPending = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '排队探测',
    params: {
      model: `comfy:${wfId}`,
      n: 1,
      workflowId: wfId,
      workflowParams: { p8: 777 },
      workflowRandomize: { p8: false, p3: false },
      displayName: '测试工作流',
    },
    refs: [],
  })
  const listPending = await h.op('job.list')
  ok(
    'job.list 含刚提交的任务',
    (listPending?.jobs || []).some((job) => job.jobId === genPending.jobId),
    JSON.stringify(listPending?.jobs?.length),
  )
  let pendingView = null
  for (let i = 0; i < 12; i += 1) {
    pendingView = await h.op('job.get', { jobId: genPending.jobId })
    if (pendingView && pendingView.stage) break
    await new Promise((r) => setTimeout(r, 400))
  }
  ok('job.get 暴露排队阶段', pendingView?.stage === 'queued', JSON.stringify(pendingView))
  await h.op('job.cancel', { jobId: genPending.jobId })
  let listAfter = null
  for (let i = 0; i < 15; i += 1) {
    listAfter = await h.op('job.list')
    if (!(listAfter?.jobs || []).some((job) => job.jobId === genPending.jobId)) break
    await new Promise((r) => setTimeout(r, 300))
  }
  ok(
    '取消后任务从列表移除',
    !(listAfter?.jobs || []).some((job) => job.jobId === genPending.jobId),
    JSON.stringify(listAfter?.jobs?.length),
  )
  mockState.neverComplete = false

  section('4e. 本地 ComfyUI 任务不受 300 秒超时限制')
  const savedTimeout = await h.op('settings.set', { jobTimeoutMs: 10000 })
  ok('设置 10 秒超时', savedTimeout?.jobTimeoutMs === 10000, JSON.stringify(savedTimeout?.jobTimeoutMs))
  resetState()
  mockState.neverComplete = true
  const genNoTimeout = await h.op('generate', {
    workspaceId: wsId,
    conversationId: convId,
    prompt: '超时验证',
    params: {
      model: `comfy:${wfId}`,
      n: 1,
      workflowId: wfId,
      workflowParams: { p8: 777 },
      workflowRandomize: { p8: false, p3: false },
      displayName: '测试工作流',
    },
    refs: [],
  })
  await new Promise((resolve) => setTimeout(resolve, 12000))
  const stillRunning = await h.op('job.get', { jobId: genNoTimeout.jobId })
  ok(
    '超过 jobTimeoutMs 后 ComfyUI 任务仍在运行（不被超时杀掉）',
    stillRunning?.status === 'running' || stillRunning?.status === 'queued',
    JSON.stringify(stillRunning),
  )
  await h.op('job.cancel', { jobId: genNoTimeout.jobId })
  mockState.neverComplete = false
  await h.op('settings.set', { jobTimeoutMs: 300000 })

  section('5. 错误路径')
  mockState.failSystemStats = true
  const bad = await h.op('comfy.status')
  ok('ComfyUI 不可达时 comfy.status ok:false', bad?.ok === false && typeof bad.error === 'string', JSON.stringify(bad))
  mockState.failSystemStats = false
  void mockState
} finally {
  await mock.close()
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'))
  process.exitCode = 1
}
