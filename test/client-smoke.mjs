// Independent client-module smoke test: loads client.js in a stubbed browser/React
// environment, applies it to a fake cordis context, and renders the registered
// panel component once to catch load-time and render-time crashes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = process.env.IW_CLIENT || join(HERE, '..', 'client.js')
const code = readFileSync(CLIENT, 'utf8')

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

/* ---------------- minimal element / DOM stubs ---------------- */
function makeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    nodeType: 1,
    nodeValue: null,
    textContent: '',
    innerHTML: '',
    className: '',
    id: '',
    value: '',
    checked: false,
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientWidth: 800,
    clientHeight: 600,
    offsetWidth: 800,
    offsetHeight: 36,
    appendChild(c) {
      this.children.push(c)
      this.childNodes.push(c)
      return c
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c)
      return c
    },
    insertBefore(c) {
      this.children.unshift(c)
      return c
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    blur() {},
    click() {},
    contains() {
      return false
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 800, bottom: 36, width: 800, height: 36, x: 0, y: 0 }
    },
    getComputedStyle() {
      return { getPropertyValue: () => '' }
    },
  }
  return el
}

const listeners = {}
const localStorageData = new Map()
const win = {
  __ModuleLoader__: null,
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  location: { href: 'http://127.0.0.1:63577/', origin: 'http://127.0.0.1:63577', search: '', hash: '', pathname: '/' },
  navigator: { userAgent: 'node-smoke', platform: 'Win32', language: 'zh-CN', clipboard: { writeText: async () => {} } },
  localStorage: {
    getItem: (k) => (localStorageData.has(k) ? localStorageData.get(k) : null),
    setItem: (k, v) => localStorageData.set(k, String(v)),
    removeItem: (k) => localStorageData.delete(k),
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  addEventListener(type, fn) {
    listeners[type] = listeners[type] || []
    listeners[type].push(fn)
  },
  removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => '', fontSize: '12px', lineHeight: '16px' }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  confirm: () => true,
  alert() {},
  fetch: async () => {
    throw new Error('fetch not stubbed in smoke test')
  },
}
const doc = {
  documentElement: makeElement('html'),
  body: makeElement('body'),
  head: makeElement('head'),
  createElement: (tag) => makeElement(tag),
  createTextNode: (t) => ({ nodeType: 3, textContent: t, nodeValue: t }),
  createDocumentFragment: () => makeElement('fragment'),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
  hidden: false,
}
globalThis.window = win
globalThis.document = doc
globalThis.localStorage = win.localStorage
try { globalThis.location = win.location } catch {}
try { globalThis.matchMedia = win.matchMedia } catch {}
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.requestAnimationFrame = win.requestAnimationFrame
globalThis.cancelAnimationFrame = win.cancelAnimationFrame

/* ---------------- React stub (hooks + element trees) ---------------- */
const states = []
function createElement(type, props, ...children) {
  const next = { ...(props || {}) }
  if (children.length === 1) next.children = children[0]
  else if (children.length > 1) next.children = children
  return { $$el: true, type, props: next }
}
const ReactStub = {
  createElement,
  Fragment: 'Fragment',
  useState(initial) {
    const idx = states.length
    states.push(typeof initial === 'function' ? initial() : initial)
    return [
      states[idx],
      (next) => {
        states[idx] = typeof next === 'function' ? next(states[idx]) : next
      },
    ]
  },
  useEffect() {},
  useLayoutEffect() {},
  useRef(v) {
    return { current: v }
  },
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  },
  useReducer(reducer, init) {
    return [typeof init === 'function' ? init() : init, () => {}]
  },
  useContext() {
    return {}
  },
  useId() {
    return 'id-1'
  },
  memo: (c) => c,
  forwardRef: (c) => c,
  createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
  Children: { map: (c, fn) => (Array.isArray(c) ? c.map(fn) : []), toArray: (c) => (Array.isArray(c) ? c : []) },
  cloneElement: (el) => el,
  PureComponent: class {},
  Component: class {},
  StrictMode: 'StrictMode',
}

/* ---------------- module loader ---------------- */
let exported = null
const registrations = []
win.__ModuleLoader__ = {
  load(meta) {
    registrations.push(meta.id || '(anonymous)')
    const module = meta.factory((spec) => {
      if (spec === 'react') return ReactStub
      throw new Error(`unexpected require: ${spec}`)
    })
    exported = module
  },
}

console.log('== 1. 模块加载 ==')
let loadError = null
try {
  // The bundle is a plain script that references window/document globals.
  // eval in the global scope (not a module scope) so top-level `const` behave
  // like the browser's classic script environment.
  new Function(code)()
} catch (error) {
  loadError = error
}
ok('client.js 顶层执行无异常', !loadError, loadError && `${loadError.message}\n${String(loadError.stack).split('\n').slice(0, 4).join('\n')}`)
ok('注册到 __ModuleLoader__', registrations.length === 1, JSON.stringify(registrations))
  ok('注册 id 与包名一致（修复点）', registrations[0] === 'dsh-creation-workbench', String(registrations[0]))
ok('导出对象含 apply', Boolean(exported && typeof exported.apply === 'function'), Object.keys(exported || {}).join(','))
ok('导出名正确', exported?.name === 'dsh-creation-workbench-client', String(exported?.name))

console.log('\n== 2. apply 到伪造 cordis 上下文 ==')
const registered = { sidebar: [], main: [] }
const ctx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  locale: { id: 'zh', current: 'zh', get: () => 'zh' },
  slots: {
    inject(name, cb) {
      try {
        cb()
      } catch (e) {
        throw e
      }
    },
    register(spec, component) {
      if (spec.name === 'sidebar.panellist') registered.sidebar.push({ spec, component })
      else registered.main.push({ spec, component })
      return { dispose() {} }
    },
  },
  get(name) {
    if (name === 'locale') return { id: 'zh', current: 'zh' }
    return undefined
  },
  effect(fn) {
    try {
      fn()
    } catch {
      // ignore
    }
  },
}
let applyError = null
try {
  exported?.apply(ctx)
} catch (error) {
  applyError = error
}
ok('apply 不抛异常', !applyError, applyError && applyError.message)
ok('侧栏图标已注册', registered.sidebar.length === 1)
ok('主面板已注册', registered.main.length === 1)
ok('侧栏标签为 AI 创作工作台', registered.sidebar[0]?.spec?.label?.() === 'AI 创作工作台', JSON.stringify(registered.sidebar[0]?.spec?.label?.()))

console.log('\n== 3. 渲染已注册组件（首次渲染不崩溃） ==')
function normalize(node, depth = 0) {
  if (node == null || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) return node.map((n) => normalize(n, depth + 1)).filter(Boolean)
  if (!node.$$el) return null
  if (typeof node.type === 'function') {
    if (depth > 14) return null
    let out
    try {
      const proto = node.type.prototype
      if (proto && (proto.isReactComponent || typeof proto.render === 'function')) {
        const instance = new node.type(node.props || {})
        instance.props = node.props || {}
        instance.state = instance.state || {}
        out = instance.render()
      } else {
        out = node.type(node.props || {})
      }
    } catch (e) {
      throw new Error(`component ${node.type.name || '(anon)'} threw: ${e.message}`)
    }
    return normalize(out, depth + 1)
  }
  const children = node.props ? node.props.children : null
  const out = { tag: node.type, children: normalize(children, depth + 1) }
  if (node.props && typeof node.props.className === 'string') out.cls = node.props.className
  return out
}
for (const entry of [registered.sidebar[0], registered.main[0]]) {
  let renderError = null
  let tree = null
  try {
    tree = normalize(createElement(entry.component, {}))
  } catch (error) {
    renderError = error
  }
  ok(`渲染 ${entry.component?.name || '(component)'} 不崩溃`, !renderError, renderError && renderError.message)
  const serialized = JSON.stringify(tree || null)
  ok(
    `渲染 ${entry.component?.name || '(component)'} 产出节点树`,
    Boolean(tree) && serialized.length > 20,
    `len=${serialized.length}`,
  )
}

console.log('\n== 4. 关键实现存在性（静态） ==')
ok('BUILD 已递增', /2026-11-13-client-m2-27/.test(code))
ok('comfy optgroup 文案存在', /ComfyUI 工作流/.test(code))
ok('动态参数行类名存在', /iw-composer-params/.test(code))
ok('参数编辑器存在', /ComfyParamEditor/.test(code))
ok('素材保存目录提示存在', /生成的图片（含 ComfyUI 输出）保存到这里/.test(code))
ok('顶栏任务入口存在', /iw-topbar-tasks/.test(code))
ok('跨会话任务列表 RPC 已接线', /rpc\('job.list'\)/.test(code))
ok('任务面板行渲染存在', /iw-task-row/.test(code))
ok('会话草稿持久化存在', /drafts: draftRef\.current/.test(code))
ok('会话草稿切换恢复存在', /draftRef\.current\[previousId\]/.test(code))
ok('ComfyUI 占位提示已区分', /ComfyUI 工作流模式：文字写入绑定的提示词节点/.test(code))
ok('会话级工作流/参数快照存在', /conversationParams: convParamsRef\.current/.test(code))
ok('活动栏四个标签', /WORKBENCH_TABS/.test(code) && /资产库/.test(code) && /工作流/.test(code))
ok('工作区首页问候存在', /现在想干什么呀/.test(code))
ok('首页生成分类存在', /生成视频/.test(code) && /生成声音/.test(code))
ok('工作流分类助手存在', /workflowCategoryLabel/.test(code))
ok('分类选择器存在', /自定义分类名/.test(code))
ok('工作流看板存在', /iw-workflow-grid/.test(code))
ok('主区域跟随标签存在', /iw-workspace-view/.test(code))
ok('切换会话恢复参数快照', /convParamsRef\.current\[previousId\]/.test(code))
ok('排队任务显示排队中', /排队中…/.test(code) && /queued/.test(code))
ok('本地任务无超时文案', /本地 ComfyUI 任务不设超时/.test(code))
ok('按任务实际开始时间计时', /job\.startedAt/.test(code))


console.log('\n== 5. 参数暴露编辑器渲染（两栏选择器） ==')

function extractFn(src, name, endMarker) {
  const start = src.indexOf('    function ' + name)
  if (start < 0) return ''
  const end = endMarker ? src.indexOf(endMarker, start) : src.indexOf('\n    }\n', start) + 7
  return src.slice(start, end)
}
const editorSlice = code.slice(
  code.indexOf('function compareComfyNodeId'),
  code.indexOf('/* ===== 72-proxy-onboard.js ===== */'),
)
const factory = new Function(
  'h', 'React', 'useState', 'useEffect', 'useRef',
  'Modal', 'Field', 'Btn', 'Icon', 'Spinner', 'Select',
  'str', 'isObj', 'cx', 'num', 'COMFY_PARAM_TYPES',
  'WORKFLOW_CATEGORY_ORDER', 'WORKFLOW_CATEGORY_LABELS', 'workflowCategoryLabel',
  editorSlice + '\nreturn ComfyParamEditor',
)
const SelectStub = (p) => createElement('select-stub', p)
const Editor = factory(
  createElement, ReactStub, ReactStub.useState, ReactStub.useEffect, ReactStub.useRef,
  (p) => createElement('modal-stub', p), (p) => createElement('field-stub', p),
  (p) => createElement('btn-stub', p), (p) => createElement('icon-stub', p),
  (p) => createElement('spinner-stub', p), SelectStub,
  (v) => (v == null ? '' : String(v)), (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  (...parts) => parts.filter(Boolean).join(' '), (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
  ['text', 'int', 'float', 'bool', 'select'],
  ['edit', 'image', 'video', 'audio', 'model'],
  { edit: '编辑', image: '生图', video: '生视频', audio: '生音频', model: '生模型' },
  (category) =>
    ({ edit: '编辑', image: '生图', video: '生视频', audio: '生音频', model: '生模型' }[category] ||
      category ||
      '生图'),
)

const inputsOf = (specs) => specs.map(([inputName, type, value]) => ({ inputName, type, value }))
const draftNodes = [
  { nodeId: '14', classType: 'ResolutionSelector', title: '分辨率选择器', inputs: inputsOf([['resolution', 'select', '1024'], ['width', 'int', 1024], ['height', 'int', 1024]]) },
  { nodeId: '23:15', classType: 'GenerateText', title: 'Generate Text', inputs: inputsOf([['max_length', 'int', 32768], ['temperature', 'float', 0.7], ['prompt', 'text', 'hello']]) },
  { nodeId: '23:19', classType: 'SaveImage', title: '保存图像', inputs: inputsOf([['filename_prefix', 'text', 'x']]) },
]
const templates = {}
const selected = {}
for (const node of draftNodes) {
  for (const input of node.inputs) {
    const key = node.nodeId + '.' + input.inputName
    templates[key] = { key: '', nodeId: node.nodeId, inputName: input.inputName, label: input.inputName, type: input.type, optionsText: '', minText: '', maxText: '', stepText: '', defaultText: String(input.value), role: 'normal', randomize: false }
    selected[key] = input.inputName === 'prompt' || input.inputName === 'width'
  }
}
const draft = {
  id: '', name: 'editor test', json: {}, nodes: draftNodes,
  outputs: [{ nodeId: '23:19', classType: 'SaveImage' }],
  warnings: [], suggestedParams: [{ nodeId: '14', inputName: 'width' }],
  selected, templates, isNew: true,
}
let editorError = null
let tree = null
try {
  tree = normalize(createElement(Editor, { draft, onCancel() {}, onDone() {}, onSave: async () => {} }))
} catch (error) {
  editorError = error
}
ok('编辑器渲染不崩溃', !editorError, editorError && editorError.message)
const flat = JSON.stringify(tree || {})
ok('左侧节点列表渲染 3 个节点', (flat.match(/iw-comfy-picker-item/g) || []).length >= 3, String((flat.match(/iw-comfy-picker-item/g) || []).length))
ok('右侧详情渲染输入行', (flat.match(/iw-comfy-input-row/g) || []).length >= 3, String((flat.match(/iw-comfy-input-row/g) || []).length))
ok('工具栏含全选建议参数', /全选建议参数/.test(flat))
ok('工具栏含搜索框', /iw-comfy-search/.test(flat))
ok('两栏容器存在', /iw-comfy-picker-list|iw-comfy-picker-detail/.test(flat))
ok('输出节点标记存在', /输出/.test(flat))
ok('已勾选计数显示', /已勾选/.test(flat) && /个参数/.test(flat))
ok('参数顺序预览存在', /对话框参数顺序/.test(flat))
ok('顺序预览渲染已选参数 chip', (flat.match(/iw-comfy-order-item/g) || []).length >= 2, String((flat.match(/iw-comfy-order-item/g) || []).length))
ok('顺序预览有拖动句柄', /iw-comfy-order-handle/.test(flat))


console.log('\n== 6. 参数勾选/主提示词绑定逻辑 ==')
const draftSlice = code.slice(
  code.indexOf('function comfyInputTypeOf'),
  code.indexOf('function modelLabel'),
)
const draftFactory = new Function('str', 'isObj', 'num', 'COMFY_PARAM_TYPES', draftSlice + '\nreturn { buildComfyEditorDraft }')
const { buildComfyEditorDraft } = draftFactory(
  (v) => (v == null ? '' : String(v)),
  (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
  ['text', 'int', 'float', 'bool', 'select'],
)

const inspection = {
  nodes: [
    { nodeId: '5', classType: 'PrimitiveStringMultiline', title: 'PrimitiveStringMultiline', inputs: [{ inputName: 'value', type: 'text', value: '' }] },
    { nodeId: '13', classType: 'KSampler', title: 'K采样器', inputs: [{ inputName: 'seed', type: 'int', value: 42 }] },
    { nodeId: '17', classType: 'ResolutionSelector', title: '分辨率选择器', inputs: [{ inputName: 'megapixels', type: 'int', value: 2 }] },
  ],
  outputs: [{ nodeId: '18', classType: 'SaveImage', kinds: ['image'] }],
  suggestedParams: [
    { key: 'p_1', nodeId: '5', inputName: 'value', label: '提示词', type: 'text', role: 'prompt', default: '' },
    { key: 'p_2', nodeId: '13', inputName: 'seed', label: 'seed', type: 'int', role: 'normal', randomize: true, default: 42 },
  ],
  warnings: [],
}

const fresh = buildComfyEditorDraft({ name: 'new', inspection })
ok('新导入：建议参数被预勾选（含提示词）', !!fresh.selected['5.value'] && !!fresh.selected['13.seed'] && fresh.selected['17.megapixels'] !== true)
ok('新导入：提示词模板 role=prompt', fresh.templates['5.value'].role === 'prompt')
ok('新导入：顺序按建议优先级（提示词在前）', JSON.stringify(fresh.order) === JSON.stringify(['5.value', '13.seed']), JSON.stringify(fresh.order))

const edited = buildComfyEditorDraft({
  id: 'wf_12345678',
  name: 'saved',
  json: { 5: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'x' } } },
  inspection,
  existingParams: [
    { key: 'p_1', nodeId: '5', inputName: 'value', label: '提示词', type: 'text', role: 'prompt', default: '' },
    { key: 'p_3', nodeId: '17', inputName: 'megapixels', label: '像素', type: 'int', role: 'normal', default: 2 },
  ],
})
ok('再次编辑：只保留已保存的勾选', !!edited.selected['5.value'] && !!edited.selected['17.megapixels'])
ok('再次编辑：顺序沿用已保存参数顺序', JSON.stringify(edited.order) === JSON.stringify(['5.value', '17.megapixels']), JSON.stringify(edited.order))
ok('再次编辑：不再自动勾选建议参数 seed（修复点）', edited.selected['13.seed'] !== true, String(edited.selected['13.seed']))

const noPrompt = buildComfyEditorDraft({
  id: 'wf_12345678',
  inspection: { nodes: inspection.nodes.slice(1), outputs: inspection.outputs, suggestedParams: [inspection.suggestedParams[1]], warnings: [] },
  existingParams: [{ key: 'p_2', nodeId: '13', inputName: 'seed', label: 'seed', type: 'int', role: 'normal', default: 42 }],
})
ok('无提示词绑定的旧工作流：模板/勾选不被污染', !!noPrompt.selected['13.seed'] && noPrompt.selected['5.value'] !== true)

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'))
  process.exitCode = 1
}
