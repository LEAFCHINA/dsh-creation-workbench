// End-to-end test for the ComfyUI workflow mode (host side).
// Run: node e2e.mjs      (exits non-zero on failure)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from './rpc-harness.mjs'
import { createServer } from 'node:http'
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
const chatCalls = []
const chatServer = await new Promise((resolve) => {
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { chatCalls.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) }) } catch { chatCalls.push({ url: req.url, raw }) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '测试提示词：雨夜霓虹街头，35mm，浅景深' } }] }))
    })
  })
  server.listen(18189, '127.0.0.1', () => resolve(server))
})
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

  const timedJob = view
  ok(
    'job.get 带 timing 明细',
    !!timedJob?.timing && typeof timedJob.timing.runMs === 'number',
    JSON.stringify(timedJob?.timing),
  )

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
  const stats = await h.op('comfy.status')
  ok(
    'comfy.status 返回显存汇总',
    !!stats?.vram && stats.vram.totalBytes > 0 && stats.vram.usedBytes >= 0,
    JSON.stringify(stats?.vram),
  )
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

  const freed = await h.op('comfy.free')
  ok('comfy.free 调用成功', freed?.ok === true, JSON.stringify(freed))

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

  section('4f. 提示词模板 CRUD')
  const tplCreated = await h.op('template.save', {
    name: '胶片人像',
    category: '人像',
    content: '{{主体}}，{{风格}}，35mm 胶片，浅景深',
    variables: [
      { key: '主体', label: '主体', default: '少女' },
      { key: '风格', label: '风格', default: '复古' },
    ],
    bindWorkflowCategory: 'image',
  })
  const tplId = tplCreated?.template?.id
  ok('template.save 返回 id', typeof tplId === 'string' && tplId.startsWith('tpl_'), JSON.stringify(tplCreated))
  const tplList = await h.op('template.list')
  const tplItem = (tplList?.templates || []).find((item) => item.id === tplId)
  ok('template.list 含模板与变量', !!tplItem && tplItem.variables.length === 2, JSON.stringify(tplItem))
  ok('模板绑定工作流分类保留', tplItem?.bindWorkflowCategory === 'image', JSON.stringify(tplItem?.bindWorkflowCategory))
  ok('模板默认交互方式为会话', tplItem?.mode === 'chat', JSON.stringify(tplItem?.mode))
  const tplTouched = await h.op('template.touch', { id: tplId })
  ok('template.touch 累加使用次数', tplTouched?.usageCount === 1, JSON.stringify(tplTouched))
  const tplUpdated = await h.op('template.save', {
    id: tplId,
    name: '胶片人像 2',
    category: '人像',
    content: '{{主体}}，电影感',
    variables: [{ key: '主体', label: '主体', default: '少年' }],
  })
  ok('template.save 更新生效', tplUpdated?.template?.name === '胶片人像 2', JSON.stringify(tplUpdated?.template?.name))
  let tplRejected = false
  try {
    await h.op('template.save', { name: '空内容', content: '   ' })
  } catch (err) {
    tplRejected = err.status === 400 || err.code === 'INVALID_REQUEST'
  }
  ok('空模板内容被拒绝', tplRejected)
  await h.op('template.delete', { id: tplId })
  const tplAfterDelete = await h.op('template.list')
  ok('模板删除生效', !(tplAfterDelete?.templates || []).some((item) => item.id === tplId))

  section('4g. Agent 模板（LLM 通道）')
  const agentSettings = await h.op('settings.set', {
    agentSource: 'api',
    agentBaseUrl: 'http://127.0.0.1:18189/v1',
    agentApiKey: 'sk-test-agent',
    agentModel: 'test-model',
  })
  ok('Agent 设置保存', agentSettings?.agentModel === 'test-model' && agentSettings?.agentApiKeySet === true, JSON.stringify(agentSettings))
  const probe = await h.op('agent.probe')
  ok('agent.probe 返回探测结构', Array.isArray(probe?.available) && typeof probe?.hint === 'string', JSON.stringify(probe))
  const agentTpl = await h.op('template.save', {
    name: '反推提示词',
    category: 'Agent',
    kind: 'agent',
    content: '【附加上下文】风格必须以胶片质感描述为准。',
    variables: [],
    agent: {
      inputTypes: ['text', 'image'],
      systemPrompt: '你是提示词工程师',
      userTemplate: '根据以下输入生成提示词：{{input}}',
      outputFormat: 'prompt',
      model: 'test-model',
    },
  })
  const agentTplId = agentTpl?.template?.id
  ok('Agent 模板保存返回 id', typeof agentTplId === 'string', JSON.stringify(agentTpl))
  const agentList = await h.op('template.list')
  const agentItem = (agentList?.templates || []).find((item) => item.id === agentTplId)
  ok('模板 kind/agent 字段保留', agentItem?.kind === 'agent' && agentItem?.agent?.inputTypes?.length === 2, JSON.stringify(agentItem))
  const runText = await h.op('agent.run', { templateId: agentTplId, input: { text: '雨夜街头' } })
  ok('agent.run 返回提示词', /测试提示词/.test(runText?.prompt || ''), JSON.stringify(runText))
  const call = chatCalls[0]
  ok('Chat 请求带模型与鉴权', call?.body?.model === 'test-model' && /Bearer sk-test-agent/.test(call?.headers?.authorization || ''), JSON.stringify({ model: call?.body?.model, auth: call?.headers?.authorization }))
  ok('Chat 消息含 system + user 模板', call?.body?.messages?.[0]?.role === 'system' && /雨夜街头/.test(JSON.stringify(call?.body?.messages?.[1] || {})), JSON.stringify(call?.body?.messages))
  const firstTurnSystem = String(chatCalls[0]?.body?.messages?.[0]?.content || '')
  ok(
    '首轮 system prompt 含模板上下文',
    /胶片质感/.test(firstTurnSystem) && /以下是本模板附带的规则/.test(firstTurnSystem),
    String(firstTurnSystem.length),
  )
  ok(
    '模板附加上下文进入 system prompt',
    /胶片质感/.test(String(call?.body?.messages?.[0]?.content || '')),
    String(call?.body?.messages?.[0]?.content || '').slice(0, 120),
  )
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const runImage = await h.op('agent.run', { templateId: agentTplId, input: { text: '反推这张图', imageBase64: tinyPng, imageMime: 'image/png' } })
  ok('agent.run 支持图片输入', /测试提示词/.test(runImage?.prompt || ''), JSON.stringify(runImage))
  const imageCall = chatCalls[1]
  ok('图片以 image_url data URL 发送', /data:image\/png;base64/.test(JSON.stringify(imageCall?.body?.messages || [])), JSON.stringify(imageCall?.body?.messages)?.slice(0, 200))
  const multiTurn = await h.op('agent.run', {
    templateId: agentTplId,
    messages: [
      { role: 'user', text: '第一轮：雨夜街头' },
      { role: 'assistant', text: '第一轮回复：霓虹街头人像' },
      { role: 'user', text: '第二轮：改成白天' },
    ],
  })
  ok('多轮 agent.run 返回提示词', /测试提示词/.test(multiTurn?.prompt || ''), JSON.stringify(multiTurn))
  ok('多轮返回轮次数', multiTurn?.turns === 3, JSON.stringify(multiTurn?.turns))
  const multiCall = chatCalls[chatCalls.length - 1]
  const multiMsgs = multiCall?.body?.messages || []
  ok(
    '多轮请求按顺序带 system + 三轮对话',
    multiMsgs.length === 4 &&
      multiMsgs[0].role === 'system' &&
      multiMsgs[1].role === 'user' &&
      multiMsgs[2].role === 'assistant' &&
      multiMsgs[3].role === 'user',
    JSON.stringify(multiMsgs.map((m) => m.role)),
  )
  const multiSystem = String(multiCall?.body?.messages?.[0]?.content || '')
  ok(
    '后续轮次不再重复发送模板长上下文',
    !/胶片质感/.test(multiSystem) && /增量修改/.test(multiSystem) && multiSystem.length < firstTurnSystem.length,
    String(multiSystem.length),
  )
  ok(
    '多轮历史内容保留',
    /第一轮：雨夜街头/.test(JSON.stringify(multiMsgs[1])) && /第一轮回复/.test(String(multiMsgs[2]?.content || '')),
    JSON.stringify(multiMsgs[2])?.slice(0, 120),
  )
  let lastAssistantRejected = false
  try {
    await h.op('agent.run', {
      templateId: agentTplId,
      messages: [
        { role: 'user', text: 'x' },
        { role: 'assistant', text: 'y' },
      ],
    })
  } catch (err) {
    lastAssistantRejected = err.status === 400
  }
  ok('最后一条必须是用户消息', lastAssistantRejected)

  let agentNoInput = false
  try {
    await h.op('agent.run', { templateId: agentTplId, input: { text: '' } })
  } catch (err) {
    agentNoInput = err.status === 400 || err.code === 'INVALID_REQUEST'
  }
  ok('空输入被拒绝', agentNoInput)
  const dshModels = await h.op('agent.models')
  ok('agent.models 在无 ctx 时返回可读结构', dshModels?.ok === false && typeof dshModels?.error === 'string', JSON.stringify(dshModels))
  const dshSettings = await h.op('settings.set', { agentSource: 'dsh', agentDshProvider: 'deepseek', agentDshModel: 'deepseek-chat' })
  ok('DSH 路由设置保存', dshSettings?.agentDshProvider === 'deepseek' && dshSettings?.agentDshModel === 'deepseek-chat', JSON.stringify(dshSettings))
  let dshError = ''
  try {
    await h.op('agent.run', { templateId: agentTplId, input: { text: 'x' } })
  } catch (err) {
    dshError = String(err?.message || '')
  }
  ok('DSH 通道未适配时给出可读错误', /DSH|模型服务/.test(dshError), dshError)
  await h.op('settings.set', { agentSource: 'api', agentBaseUrl: '', agentModel: '', agentDshProvider: '', agentDshModel: '', clearAgentApiKey: true })
  await h.op('template.delete', { id: agentTplId })

  section('4h. DSH 模型通道（桩 ctx：文字 / 图片 / 仅文字模型）')
  const dshCalls = []
  const fakeCtx = {
    get(name) {
      if (name === 'llm') {
        return {
          listProviders: () => [{ id: 'stub-provider', name: 'Stub' }],
          listModels: async () => [
            { id: 'stub-vision', name: 'Stub Vision', inputModalities: ['text', 'image'] },
            { id: 'stub-text', name: 'Stub Text', inputModalities: ['text'] },
          ],
          resolveModelInfo: async (provider, model) => ({
            provider,
            id: model,
            name: model,
            inputModalities: model === 'stub-vision' ? ['text', 'image'] : ['text'],
          }),
          prepareCall: async (config) => ({
            config: { ...config },
            stream: (options) => {
              dshCalls.push({ config, options })
              return (async function* () {
                yield { type: 'text-delta', index: 0, text: 'DSH 生成：电影感霓虹' }
                yield { type: 'finish', reason: { kind: 'stop' } }
              })()
            },
          }),
        }
      }
      if (name === 'attachments') {
        return {
          async admitPromptContent(content) {
            return content.map((part) =>
              part.type === 'image'
                ? {
                    type: 'image',
                    attachment: {
                      attachmentId: 'sha256:' + 'a'.repeat(64),
                      mediaType: part.mediaType,
                      name: part.name,
                    },
                  }
                : { type: 'text', text: part.text },
            )
          },
        }
      }
      return null
    },
  }
  h.env.ctx = fakeCtx
  const dshAgentTpl = await h.op('template.save', {
    name: 'DSH 图片反推',
    category: 'Agent',
    kind: 'agent',
    content: '',
    variables: [],
    agent: {
      inputTypes: ['text', 'image'],
      systemPrompt: '你是提示词工程师',
      userTemplate: '',
      outputFormat: 'prompt',
      model: '',
    },
  })
  const dshAgentTplId = dshAgentTpl?.template?.id
  await h.op('settings.set', {
    agentSource: 'dsh',
    agentDshProvider: 'stub-provider',
    agentDshModel: 'stub-vision',
  })
  const dshImageRun = await h.op('agent.run', {
    templateId: dshAgentTplId,
    input: { imageBase64: tinyPng, imageMime: 'image/png' },
  })
  ok('DSH 通道图片反推成功', /DSH 生成/.test(dshImageRun?.prompt || ''), JSON.stringify(dshImageRun))
  ok('DSH 通道返回 model 标识', String(dshImageRun?.model || '').includes('stub-provider'), JSON.stringify(dshImageRun?.model))
  const dshImageMsg = dshCalls[dshCalls.length - 1]?.options?.messages?.[0]
  ok(
    'DSH 请求包含 image 内容块',
    Array.isArray(dshImageMsg?.content) && dshImageMsg.content.some((block) => block.type === 'image'),
    JSON.stringify(dshImageMsg?.content)?.slice(0, 200),
  )
  const dshTextRun = await h.op('agent.run', {
    templateId: dshAgentTplId,
    input: { text: '雨夜街头' },
  })
  ok('DSH 通道纯文字也成功', /DSH 生成/.test(dshTextRun?.prompt || ''), JSON.stringify(dshTextRun))
  const dshMulti = await h.op('agent.run', {
    templateId: dshAgentTplId,
    messages: [
      { role: 'user', text: '这是什么？' },
      { role: 'assistant', text: '一个橙色圆形测试图。' },
      { role: 'user', text: '照着它写提示词', imageBase64: tinyPng, imageMime: 'image/png' },
    ],
  })
  ok('DSH 多轮会话成功', /DSH 生成/.test(dshMulti?.prompt || '') && dshMulti?.turns === 3, JSON.stringify(dshMulti))
  const dshMultiMessages = dshCalls[dshCalls.length - 1]?.options?.messages || []
  ok(
    'DSH 多轮带上历史消息',
    dshMultiMessages.length === 3 &&
      dshMultiMessages[1]?.role === 'assistant' &&
      /橙色圆形/.test(JSON.stringify(dshMultiMessages[1])),
    JSON.stringify(dshMultiMessages.map((m) => m.role)),
  )
  ok(
    'DSH 第二轮用户消息带图片块',
    JSON.stringify(dshMultiMessages[2]?.content || []).includes('"type":"image"'),
    JSON.stringify(dshMultiMessages[2]?.content)?.slice(0, 160),
  )
  await h.op('settings.set', { agentDshModel: 'stub-text' })
  let textOnlyError = ''
  let textOnlyCode = ''
  try {
    await h.op('agent.run', { templateId: dshAgentTplId, input: { imageBase64: tinyPng, imageMime: 'image/png' } })
  } catch (err) {
    textOnlyError = String(err?.message || '')
    textOnlyCode = String(err?.payload?.code || err?.code || '')
  }
  ok(
    '仅文字模型收到图片时给出可读错误并建议视觉模型',
    /不支持图片输入/.test(textOnlyError) && /stub-vision/.test(textOnlyError),
    textOnlyError,
  )
  ok('错误码为 AGENT_MODEL_TEXT_ONLY', textOnlyCode === 'AGENT_MODEL_TEXT_ONLY', textOnlyCode)
  h.env.ctx = undefined
  await h.op('template.delete', { id: dshAgentTplId })

  section('4i. Agent 真实会话（工作区 + 会话 + 消息持久化）')
  const chatTpl = await h.op('template.save', {
    name: 'Agent 会话测试',
    category: 'Agent',
    kind: 'agent',
    content: '',
    variables: [],
    agent: {
      inputTypes: ['text'],
      systemPrompt: '你是提示词工程师',
      userTemplate: '',
      outputFormat: 'prompt',
      model: '',
    },
  })
  const chatTplId = chatTpl?.template?.id
  const agentWs = await h.op('agent.workspace', { templateId: chatTplId, templateName: '反推提示词' })
  ok('agent.workspace 创建工作区', typeof agentWs?.workspace?.id === 'string', JSON.stringify(agentWs?.workspace))
  ok('agent.workspace 创建工作区名为 Agent 会话', /Agent/.test(String(agentWs?.workspace?.name || '')), String(agentWs?.workspace?.name))
  ok('agent.workspace 创建会话并带 meta', agentWs?.conversation?.meta?.kind === 'agent' && agentWs?.conversation?.meta?.templateId === chatTplId, JSON.stringify(agentWs?.conversation?.meta))
  const agentConvId = agentWs?.conversation?.id
  const agentWsId = agentWs?.workspace?.id
  const againSame = await h.op('agent.workspace', { templateId: chatTplId, templateName: '反推提示词' })
  ok('同一模板复用已有会话', againSame?.conversation?.id === agentConvId && againSame?.created === false, JSON.stringify(againSame?.created))
  await h.op('settings.set', { agentSource: 'api', agentBaseUrl: 'http://127.0.0.1:18189/v1', agentApiKey: 'sk-test-agent', agentModel: 'test-model' })
  const agentSent = await h.op('agent.send', { workspaceId: agentWsId, conversationId: agentConvId, text: '一只猫' })
  ok('agent.send 返回回复', /测试提示词/.test(agentSent?.prompt || ''), JSON.stringify(agentSent?.prompt))
  const convAfter = await h.op('conversation.get', { workspaceId: agentWsId, conversationId: agentConvId })
  const convObj2 = convAfter?.conversation || convAfter
  ok('会话持久化两条消息', Array.isArray(convObj2?.messages) && convObj2.messages.length === 2, JSON.stringify(convObj2?.messages?.length))
  ok(
    '消息顺序为 用户→助手',
    convObj2?.messages?.[0]?.role === 'user' && convObj2?.messages?.[1]?.role === 'assistant',
    JSON.stringify((convObj2?.messages || []).map((m) => m.role)),
  )
  const sentAgain = await h.op('agent.send', { workspaceId: agentWsId, conversationId: agentConvId, text: '换成狗' })
  ok('第二轮 agent.send 成功', /测试提示词/.test(sentAgain?.prompt || ''), JSON.stringify(sentAgain?.prompt))
  const convAfter2 = await h.op('conversation.get', { workspaceId: agentWsId, conversationId: agentConvId })
  const convObj3 = convAfter2?.conversation || convAfter2
  ok('两轮后共 4 条消息', convObj3?.messages?.length === 4, JSON.stringify(convObj3?.messages?.length))
  const clearedConv = await h.op('agent.clear', { workspaceId: agentWsId, conversationId: agentConvId })
  ok('agent.clear 清空消息', Array.isArray(clearedConv?.messages) && clearedConv.messages.length === 0, JSON.stringify(clearedConv?.messages?.length))
  const retentionSaved = await h.op('settings.set', { agentRetentionDays: 7 })
  ok('Agent 会话保留天数可保存', retentionSaved?.agentRetentionDays === 7, JSON.stringify(retentionSaved?.agentRetentionDays))
  const retentionOff = await h.op('settings.set', { agentRetentionDays: 0 })
  ok('保留天数可关闭', retentionOff?.agentRetentionDays === 0, JSON.stringify(retentionOff?.agentRetentionDays))
  await h.op('workspace.delete', { id: agentWsId })
  await h.op('template.delete', { id: chatTplId })

  section('4j. DSH 工作区/会话关联（无宿主服务时安全降级）')
  const linkNoCtx = await h.op('agent.link', { templateId: 'tpl_test0001', templateName: '测试' })
  ok(
    '无宿主服务时返回可读失败而非抛错',
    linkNoCtx?.ok === false && /不支持|无法/.test(String(linkNoCtx?.error || '')),
    JSON.stringify(linkNoCtx),
  )
  const linkGet = await h.op('agent.link.get', {})
  ok('agent.link.get 返回映射表', !!linkGet?.links && typeof linkGet.links === 'object', JSON.stringify(linkGet?.links))

  section('5. 错误路径')
  mockState.failSystemStats = true
  const bad = await h.op('comfy.status')
  ok('ComfyUI 不可达时 comfy.status ok:false', bad?.ok === false && typeof bad.error === 'string', JSON.stringify(bad))
  mockState.failSystemStats = false
  void mockState
} finally {
  await new Promise((resolve) => chatServer.close(resolve))
  await mock.close()
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'))
  process.exitCode = 1
}
