import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANTIGRAVITY_MODELS,
  ANTIGRAVITY_PROVIDER_ID,
  createAntigravityAdapter,
  parseGoogleOAuthInput,
  queryAntigravityUsage,
  resolveAntigravityGrant,
  runAntigravityOAuthFlow,
} from '../../app/assets/engine/auth/antigravity.mjs'
import { AuthBridge, accountOf, recordKeyFor } from '../../app/assets/engine/auth/bridge.mjs'

function memoryCredentials(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    async readRecord(key) {
      return map.get(key)
    },
    async modifyRecord(key, fn) {
      const next = await fn(map.get(key))
      if (next !== undefined) map.set(key, next)
      return next
    },
    async deleteRecord(key) {
      map.delete(key)
    },
  }
}

class FakeLlmError extends Error {
  constructor(message, code, options = {}) {
    super(message, options)
    this.code = code
    this.status = options.status
    this.offloadImages = options.offloadImages
  }
}

class FakeLlmAdapter {}

const llmHelpers = {
  CONTEXT_WINDOW_EXCEEDED_CODE: 'CONTEXT_WINDOW_EXCEEDED',
  EMPTY_RESPONSE_CODE: 'EMPTY_RESPONSE',
  IMAGE_OFFLOAD_REQUIRED_CODE: 'IMAGE_OFFLOAD_REQUIRED',
  QUOTA_EXCEEDED_CODE: 'QUOTA',
  contentHasImage: (blocks) => Array.isArray(blocks) && blocks.some((b) => b.type === 'image'),
  isContextWindowExceededError: (msg) => /context.*exceed/i.test(msg),
  isQuotaExceededError: (msg) => /insufficient.*quota|quota.*exceeded/i.test(msg),
  offloadedImageText: (ref, path) => `[offloaded ${ref.attachmentId} ${path ?? ''}]`,
  projectOffloadedImages: (msgs) => msgs,
  requestImageHandleText: (ref) => `[image ${ref.attachmentId}]`,
  requiredImageOffload: () => 0,
  resolveImageAttachmentAccess: () => undefined,
}

test('parseGoogleOAuthInput extracts code and state from redirect URLs and raw codes', () => {
  assert.deepEqual(
    parseGoogleOAuthInput('http://localhost:51121/oauth-callback?state=st1&code=cd1&scope=a'),
    { code: 'cd1', state: 'st1', error: undefined },
  )
  assert.deepEqual(parseGoogleOAuthInput('raw_auth_code'), { code: 'raw_auth_code' })
  assert.deepEqual(parseGoogleOAuthInput('  '), {})
})

test('runAntigravityOAuthFlow exchanges Google PKCE code, discovers project, and commits grant', async () => {
  const key = recordKeyFor(ANTIGRAVITY_PROVIDER_ID)
  const creds = memoryCredentials()
  const notices = []
  let capturedState
  const requests = []

  const fakeFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'goog-access-1',
          refresh_token: 'goog-refresh-1',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (String(url).includes('/oauth2/v1/userinfo')) {
      return new Response(JSON.stringify({ email: 'alice@gmail.com' }), { status: 200 })
    }
    if (String(url).includes(':loadCodeAssist')) {
      return new Response(JSON.stringify({ cloudaicompanionProject: { id: 'my-gcp-project' } }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const fakeCreateServer = () => {
    const err = Object.assign(new Error('port busy'), { code: 'EADDRINUSE' })
    return {
      once(ev, cb) {
        if (ev === 'error') this._err = cb
      },
      off() {},
      listen(_opts, _cb) {
        queueMicrotask(() => this._err?.(err))
      },
      close() {},
    }
  }

  const controller = new AbortController()
  await runAntigravityOAuthFlow(
    {
      signal: controller.signal,
      notify: (n) => {
        notices.push(n)
        if (n.url) capturedState = new URL(n.url).searchParams.get('state')
      },
      prompt: async () => `http://localhost:51121/oauth-callback?code=auth-code-99&state=${capturedState}`,
      commit: async (record) => {
        await creds.modifyRecord(key, async () => record)
      },
    },
    { fetch: fakeFetch, createServer: fakeCreateServer },
  )

  assert.ok(notices.some((n) => n.url?.startsWith('https://accounts.google.com/o/oauth2/v2/auth')))
  const saved = await creds.readRecord(key)
  assert.equal(saved.kind, 'grant')
  assert.equal(saved.payload.access, 'goog-access-1')
  assert.equal(saved.payload.refresh, 'goog-refresh-1')
  assert.equal(saved.payload.email, 'alice@gmail.com')
  assert.equal(saved.payload.projectId, 'my-gcp-project')
  assert.equal(accountOf(ANTIGRAVITY_PROVIDER_ID, saved.payload), 'alice@gmail.com')
})

test('resolveAntigravityGrant refreshes expired OAuth access token via modifyRecord', async () => {
  const key = recordKeyFor(ANTIGRAVITY_PROVIDER_ID)
  const creds = memoryCredentials({
    [key]: {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: 'stale-access',
        refresh: 'valid-refresh',
        expires: Date.now() - 60_000,
        projectId: 'proj-1',
        email: 'bob@gmail.com',
      },
    },
  })

  const fakeFetch = async (url) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token')
    return new Response(
      JSON.stringify({ access_token: 'fresh-access', expires_in: 3600 }),
      { status: 200 },
    )
  }

  const resolved = await resolveAntigravityGrant(creds, key, fakeFetch)
  assert.deepEqual(resolved, { access: 'fresh-access', projectId: 'proj-1' })
  const stored = await creds.readRecord(key)
  assert.equal(stored.payload.access, 'fresh-access')
  assert.equal(stored.payload.refresh, 'valid-refresh')
})

test('AuthBridge integrates google-antigravity list, route callback, usage quota, and signOut', async () => {
  const key = recordKeyFor(ANTIGRAVITY_PROVIDER_ID)
  const creds = memoryCredentials({
    [key]: {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: 'live-access',
        refresh: 'live-refresh',
        expires: Date.now() + 3600_000,
        projectId: 'proj-1',
        email: 'carol@gmail.com',
      },
    },
  })

  const routeEvents = []
  const bridge = new AuthBridge({
    get: (name) => (name === 'credentials' ? creds : undefined),
    probePort: async () => true,
    onRouteChange: (provider, active) => routeEvents.push([provider, active]),
    fetch: async (url) => {
      assert.ok(String(url).includes(':fetchAvailableModels'))
      return new Response(
        JSON.stringify({
          models: {
            'gemini-3.1-pro-high': { quotaInfo: { remainingFraction: 0.75, resetTime: '2026-11-23T00:00:00Z' } },
            'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 0.5, resetTime: '2026-11-23T01:00:00Z' } },
          },
        }),
        { status: 200 },
      )
    },
  })

  const list = await bridge.list()
  const antigravity = list.providers.find((p) => p.id === ANTIGRAVITY_PROVIDER_ID)
  assert.deepEqual(antigravity, {
    id: ANTIGRAVITY_PROVIDER_ID,
    signedIn: true,
    account: 'carol@gmail.com',
  })
  assert.deepEqual(routeEvents, [[ANTIGRAVITY_PROVIDER_ID, true]])

  const usage = await bridge.usage(ANTIGRAVITY_PROVIDER_ID)
  assert.equal(usage.status, 'ok')
  assert.deepEqual(usage.windows, [
    { id: 'gemini', usedPercent: 25, resetAt: '2026-11-23T00:00:00.000Z' },
    { id: 'claude', usedPercent: 50, resetAt: '2026-11-23T01:00:00.000Z' },
  ])

  await bridge.signOut(ANTIGRAVITY_PROVIDER_ID)
  assert.deepEqual(routeEvents, [
    [ANTIGRAVITY_PROVIDER_ID, true],
    [ANTIGRAVITY_PROVIDER_ID, false],
  ])
  assert.equal(await creds.readRecord(key), undefined)
})

test('AntigravityAdapter lists models, streams reasoning/text/tool-call SSE, and preserves replayState', async () => {
  const key = recordKeyFor(ANTIGRAVITY_PROVIDER_ID)
  const creds = memoryCredentials({
    [key]: {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: 'valid-access',
        refresh: 'valid-refresh',
        expires: Date.now() + 3600_000,
        projectId: 'proj-stream',
      },
    },
  })

  const sseBody = [
    'data: ' + JSON.stringify({
      response: {
        candidates: [{ content: { parts: [{ thought: true, text: 'Let me check', thoughtSignature: 'U0lHMQ==' }] } }],
      },
    }),
    'data: ' + JSON.stringify({
      response: {
        candidates: [{ content: { parts: [{ text: 'Hello!' }] } }],
      },
    }),
    'data: ' + JSON.stringify({
      response: {
        candidates: [{
          content: { parts: [{ functionCall: { id: 'call_1', name: 'bash', args: { cmd: 'ls' } }, thoughtSignature: 'U0lHMg==' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: {
          promptTokenCount: 120,
          cachedContentTokenCount: 20,
          candidatesTokenCount: 15,
          thoughtsTokenCount: 5,
          totalTokenCount: 140,
        },
      },
    }),
    '',
  ].join('\n\n')

  let seenRequestBody
  let seenHeaders
  const AdapterClass = createAntigravityAdapter({
    LlmAdapter: FakeLlmAdapter,
    LlmError: FakeLlmError,
    llmHelpers,
    getCredentials: () => creds,
    getAttachments: () => undefined,
    getFs: () => undefined,
    recordKey: key,
    fetch: async (url, init) => {
      seenHeaders = init.headers
      seenRequestBody = JSON.parse(init.body)
      return new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    },
  })

  const adapter = new AdapterClass()
  const listed = await adapter.listModels(ANTIGRAVITY_PROVIDER_ID)
  assert.equal(listed.length, ANTIGRAVITY_MODELS.length)

  const prepared = await adapter.prepareCall(ANTIGRAVITY_PROVIDER_ID, 'gemini-3.1-pro-high')
  assert.equal(prepared.model.context.contextWindow, 1048576)

  const chunks = []
  for await (const chunk of prepared.stream({
    provider: ANTIGRAVITY_PROVIDER_ID,
    model: 'gemini-3.1-pro-high',
    reasoningEffort: 'high',
    system: 'Be concise.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Run ls' }] }],
    tools: [{ name: 'bash', description: 'Run shell', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } }],
  })) {
    chunks.push(chunk)
  }

  assert.equal(seenRequestBody.project, 'proj-stream')
  assert.equal(seenRequestBody.requestType, 'agent')
  assert.equal(seenRequestBody.request.generationConfig.thinkingConfig.thinkingLevel, 'HIGH')
  assert.match(seenHeaders['User-Agent'], /^antigravity\//)

  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'tool-calls')
  assert.deepEqual(finish.replayState, {
    response: { kind: 'antigravity', version: 1, model: 'gemini-3.1-pro-high' },
    blocks: [
      { thoughtSignature: 'U0lHMQ==' },
      {},
      { thoughtSignature: 'U0lHMg==' },
    ],
  })

  const usageChunk = chunks.at(-2)
  assert.deepEqual(usageChunk, {
    type: 'usage',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 140,
      cacheReadTokens: 20,
      reasoningTokens: 5,
    },
  })
})

test('queryAntigravityUsage maps 401 and network errors safely', async () => {
  const authErr = await queryAntigravityUsage('tok', 'proj', async () => new Response('', { status: 401 }))
  assert.deepEqual(authErr, { provider: ANTIGRAVITY_PROVIDER_ID, status: 'unavailable', windows: [], reason: 'auth_required' })

  const netErr = await queryAntigravityUsage('tok', 'proj', async () => { throw new Error('ECONNREFUSED') })
  assert.deepEqual(netErr, { provider: ANTIGRAVITY_PROVIDER_ID, status: 'unavailable', windows: [], reason: 'network' })
})
