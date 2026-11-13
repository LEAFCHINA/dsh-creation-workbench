// Mock ComfyUI server for host-side end-to-end tests.
// Endpoints implemented: /system_stats /object_info /prompt /history/:id /view /queue /interrupt /free /upload/image
import { createServer } from 'node:http'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 1x1 red PNG (valid bytes so imageSize()/detectMime() work).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export const state = {
  baseUrl: '',
  /** prompt_id -> { workflow, createdAt } */
  queue: new Map(),
  historyRequests: 0,
  viewHits: 0,
  promptCalls: 0,
  lastPromptBody: null,
  queueDeleteCalls: [],
  /** failure injection */
  failSystemStats: false,
  failPrompt: false,
  promptNodeErrors: null,
  neverComplete: false,
  /** image outputs returned by /history */
  outputs: null,
  objectInfo: null,
}

const OBJECT_INFO = {
  KSampler: {
    input: {
      required: {
        seed: ['INT', { min: 0, max: 18446744073709551615, step: 1 }],
        steps: ['INT', { min: 1, max: 10000 }],
        cfg: ['FLOAT', { min: 0, max: 100, step: 0.1 }],
        sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m', 'ddim']],
        scheduler: [['normal', 'karras', 'exponential', 'simple']],
        denoise: ['FLOAT', { min: 0, max: 1, step: 0.01 }],
      },
    },
  },
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['sd_xl_base_1.0.safetensors', 'v1-5-pruned.ckpt']] } },
  },
  EmptyLatentImage: {
    input: { required: { width: ['INT', { min: 16, max: 16384, step: 8 }], height: ['INT', { min: 16, max: 16384, step: 8 }], batch_size: ['INT', { min: 1, max: 64 }] } },
  },
  CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }] } } },
  SaveImage: { input: { required: { filename_prefix: ['STRING', {}] } } },
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
  })
}

function send(res, status, payload, contentType = 'application/json') {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, { 'content-type': contentType, 'content-length': body.length })
  res.end(body)
}

export function startMockComfy({ port = 18188 } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname

    if (path === '/system_stats') {
      if (state.failSystemStats) return send(res, 500, { error: 'mock down' })
      return send(res, 200, {
        system: { os: 'nt', comfyui_version: '0.3.99-mock', python_version: '3.12.0' },
        devices: [{ name: 'mock-cuda:0', type: 'cuda', vram_total: 25757220864, vram_free: 20000000000 }],
      })
    }

    if (path === '/upload/image' && req.method === 'POST') {
      state.uploadCalls = (state.uploadCalls || 0) + 1
      // consume the multipart body so the socket closes cleanly
      await new Promise((resolve) => {
        req.on('data', () => {})
        req.on('end', resolve)
        req.on('error', resolve)
      })
      return send(res, 200, { name: `mock-upload-${state.uploadCalls}.png`, subfolder: '', type: 'input' })
    }

    if (path === '/free' && req.method === 'POST') {
      state.freeCalls = (state.freeCalls || 0) + 1
      return send(res, 200, {})
    }

    if (path === '/object_info') {
      return send(res, 200, state.objectInfo || OBJECT_INFO)
    }

    if (path === '/prompt' && req.method === 'POST') {
      state.promptCalls += 1
      const body = await readJson(req)
      state.lastPromptBody = body
      if (state.failPrompt) return send(res, 400, { error: 'mock prompt rejected', node_errors: {} })
      if (state.promptNodeErrors) return send(res, 400, { error: { type: 'prompt_outputs_failed_validation' }, node_errors: state.promptNodeErrors })
      const promptId = `mock-${state.promptCalls}`
      state.queue.set(promptId, { workflow: body.prompt, createdAt: Date.now() })
      return send(res, 200, { prompt_id: promptId, number: state.promptCalls, node_errors: {} })
    }

    if (path.startsWith('/history/')) {
      state.historyRequests += 1
      const id = decodeURIComponent(path.slice('/history/'.length))
      const entry = state.queue.get(id)
      if (!entry || state.neverComplete) return send(res, 200, {})
      return send(res, 200, {
        [id]: {
          prompt: {},
          outputs: state.outputs || { 9: { images: [{ filename: 'mock-output.png', subfolder: '', type: 'output' }] } },
          status: { status_str: 'success', completed: true, messages: [] },
        },
      })
    }

    if (path === '/view') {
      state.viewHits += 1
      return send(res, 200, PNG, 'image/png')
    }

    if (path === '/queue' && req.method === 'POST') {
      const body = await readJson(req)
      if (Array.isArray(body.delete)) state.queueDeleteCalls.push(body.delete)
      return send(res, 200, {})
    }

    if (path === '/queue') {
      return send(res, 200, { queue_running: [], queue_pending: [] })
    }

    if (path === '/interrupt') return send(res, 200, {})

    return send(res, 404, { error: `mock: no route ${path}` })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      state.baseUrl = `http://127.0.0.1:${port}`
      resolve({ server, baseUrl: state.baseUrl, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

export function resetState() {
  state.queue.clear()
  state.historyRequests = 0
  state.viewHits = 0
  state.promptCalls = 0
  state.lastPromptBody = null
  state.queueDeleteCalls = []
  state.failSystemStats = false
  state.failPrompt = false
  state.promptNodeErrors = null
  state.neverComplete = false
  state.outputs = null
}

export { PNG, OBJECT_INFO }

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { baseUrl } = await startMockComfy({ port: Number(process.env.MOCK_PORT || 18188) })
  console.log(`mock comfy listening on ${baseUrl}`)
}
