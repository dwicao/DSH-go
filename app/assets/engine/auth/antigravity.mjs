// SPDX-License-Identifier: MIT
//
// Google Antigravity OAuth (Sign in with Google) + Cloud Code Assist LLM adapter
// for dsh-app. Zero external npm imports so it runs from any DSH install and
// can be tested directly with `node --test`.

import { createHash, randomBytes } from 'node:crypto'
import { createServer as nodeCreateServer } from 'node:http'

export const ANTIGRAVITY_PROVIDER_ID = 'google-antigravity'
export const ANTIGRAVITY_DISPLAY_NAME = 'Antigravity'
export const ANTIGRAVITY_CALLBACK_PORT = 51121
export const ANTIGRAVITY_CALLBACK_PATH = '/oauth-callback'
export const ANTIGRAVITY_REDIRECT_URI = `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}${ANTIGRAVITY_CALLBACK_PATH}`

const CLIENT_ID = atob('MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==')
const CLIENT_SECRET = atob('R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=')
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
const DEFAULT_PROJECT_ID = 'rising-fact-p41fc'

const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
]

const LOAD_CODE_ASSIST_ENDPOINTS = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
]

const ANTIGRAVITY_ENDPOINTS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
]

const DEFAULT_ANTIGRAVITY_VERSION = '1.18.4'
const CLAUDE_THINKING_BETA_HEADER = 'interleaved-thinking-2025-05-14'
const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.' +
  'You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.' +
  '**Absolute paths only**' +
  '**Proactiveness**'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 60_000
const MAX_EMPTY_STREAM_RETRIES = 2
const EMPTY_STREAM_BASE_DELAY_MS = 500
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const TOKEN_VALIDITY_MARGIN_MS = 30 * 1000
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_REQUEST_IMAGES = 50
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

const EFFORT_LABELS = Object.freeze({
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
})

const THINKING_BUDGETS = Object.freeze({
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
})

export const ANTIGRAVITY_MODELS = Object.freeze([
  Object.freeze({
    id: 'gemini-3.1-pro-high',
    name: 'Gemini 3.1 Pro High',
    reasoning: true,
    efforts: ['off', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    inputModalities: ['text', 'image'],
    contextWindow: 1048576,
    maxTokens: 65535,
  }),
  Object.freeze({
    id: 'gemini-3.1-pro-low',
    name: 'Gemini 3.1 Pro Low',
    reasoning: true,
    efforts: ['off', 'low', 'medium', 'high'],
    defaultEffort: 'low',
    inputModalities: ['text', 'image'],
    contextWindow: 1048576,
    maxTokens: 65535,
  }),
  Object.freeze({
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    reasoning: true,
    efforts: ['off', 'minimal', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    inputModalities: ['text', 'image'],
    contextWindow: 1048576,
    maxTokens: 65535,
  }),
  Object.freeze({
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 Thinking',
    reasoning: true,
    efforts: ['off', 'minimal', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    inputModalities: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 128000,
  }),
  Object.freeze({
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    reasoning: true,
    efforts: ['off', 'minimal', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    inputModalities: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  Object.freeze({
    id: 'claude-opus-4-5-thinking',
    name: 'Claude Opus 4.5 Thinking',
    reasoning: true,
    efforts: ['off', 'minimal', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    inputModalities: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  Object.freeze({
    id: 'claude-sonnet-4-5-thinking',
    name: 'Claude Sonnet 4.5 Thinking',
    reasoning: true,
    efforts: ['off', 'minimal', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    inputModalities: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  Object.freeze({
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    reasoning: false,
    efforts: [],
    inputModalities: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  Object.freeze({
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B Medium',
    reasoning: false,
    efforts: [],
    inputModalities: ['text'],
    contextWindow: 131072,
    maxTokens: 32768,
  }),
])

const MODEL_MAP = new Map(ANTIGRAVITY_MODELS.map((m) => [m.id, m]))

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export function antigravityHeaders() {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION
  return { 'User-Agent': `antigravity/${version} darwin/arm64` }
}

function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function parseGoogleOAuthInput(input) {
  const value = String(input ?? '').trim()
  if (!value) return {}
  try {
    const url = new URL(value)
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error: url.searchParams.get('error') ?? undefined,
    }
  } catch {
    // Not a full URL; check query-string or raw code forms.
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      error: params.get('error') ?? undefined,
    }
  }
  return { code: value }
}

function htmlPage(title, message) {
  const safeTitle = String(title).replace(/[<>&"]/g, '')
  const safeMsg = String(message).replace(/[<>&"]/g, '')
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px"><h1>${safeTitle}</h1><p>${safeMsg}</p></body></html>`
}

async function startLoopbackCallback({ createServer, host, port, path, expectedState, signal }) {
  let resolveResult
  let rejectResult
  const waitPromise = new Promise((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  waitPromise.catch(() => {})

  let settled = false
  const settle = (fn, value) => {
    if (settled) return
    settled = true
    fn(value)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    if (url.pathname !== path) {
      res.writeHead(404)
      res.end()
      return
    }
    const error = url.searchParams.get('error')
    if (error) {
      const desc = url.searchParams.get('error_description') || error
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(htmlPage('Authentication Failed', `Google authorization failed: ${desc}`))
      settle(rejectResult, new Error(`Google authorization failed: ${desc}`))
      return
    }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(htmlPage('Authentication Failed', 'Missing code or state parameter.'))
      return
    }
    if (state !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(htmlPage('Authentication Failed', 'OAuth state mismatch.'))
      settle(rejectResult, new Error('state mismatch'))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(htmlPage('Authentication Successful', 'Signed in with Google. You can close this tab and return to DSH Go.'))
    settle(resolveResult, { code, state })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host, exclusive: true }, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const onAbort = () => settle(rejectResult, new Error('Login cancelled'))
  signal?.addEventListener('abort', onAbort, { once: true })

  return {
    wait: () => waitPromise,
    cancel: () => settle(resolveResult, undefined),
    close: () => {
      signal?.removeEventListener('abort', onAbort)
      settle(resolveResult, undefined)
      try { server.close() } catch {}
    },
  }
}

export async function discoverAntigravityProject(accessToken, fetchImpl = globalThis.fetch, signal) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    }),
  }
  for (const endpoint of LOAD_CODE_ASSIST_ENDPOINTS) {
    try {
      const response = await fetchImpl(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
        signal,
      })
      if (!response.ok) continue
      const data = await response.json()
      if (typeof data?.cloudaicompanionProject === 'string' && data.cloudaicompanionProject.length > 0) {
        return data.cloudaicompanionProject
      }
      if (isObject(data?.cloudaicompanionProject) && typeof data.cloudaicompanionProject.id === 'string' && data.cloudaicompanionProject.id.length > 0) {
        return data.cloudaicompanionProject.id
      }
    } catch {
      if (signal?.aborted) throw new Error('Login cancelled')
    }
  }
  return DEFAULT_PROJECT_ID
}

async function fetchGoogleEmail(accessToken, fetchImpl = globalThis.fetch, signal) {
  try {
    const response = await fetchImpl(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    })
    if (!response.ok) return undefined
    const data = await response.json()
    return typeof data?.email === 'string' && data.email.includes('@') ? data.email : undefined
  } catch {
    return undefined
  }
}

/**
 * Runs Google OAuth PKCE for Antigravity inside a DSH `authorization` session
 * and commits `{ kind: 'grant', payload }` through `session.commit(...)`.
 */
export async function runAntigravityOAuthFlow(session, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const createServer = options.createServer ?? nodeCreateServer
  const callbackHost = options.callbackHost ?? (process.env.PI_OAUTH_CALLBACK_HOST || '127.0.0.1')
  const { signal } = session
  const { verifier, challenge } = generatePKCE()

  let callback
  try {
    callback = await startLoopbackCallback({
      createServer,
      host: callbackHost,
      port: ANTIGRAVITY_CALLBACK_PORT,
      path: ANTIGRAVITY_CALLBACK_PATH,
      expectedState: verifier,
      signal,
    })
  } catch {
    // Port unavailable; continue with manual redirect URL paste.
    callback = undefined
  }

  try {
    const authParams = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: ANTIGRAVITY_REDIRECT_URI,
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: verifier,
      access_type: 'offline',
      prompt: 'consent',
    })
    const authUrl = `${AUTH_URL}?${authParams.toString()}`
    session.notify({
      message: 'Complete Google sign-in in your browser.',
      url: authUrl,
    })

    const manualAbort = new AbortController()
    let manualError
    const manualPromise = session
      .prompt({
        kind: 'text',
        message: 'Complete Google sign-in in your browser, or paste the redirect URL here:',
        placeholder: ANTIGRAVITY_REDIRECT_URI,
        signal: manualAbort.signal,
      })
      .then((input) => {
        callback?.cancel()
        return input
      })
      .catch((error) => {
        manualError = error
        callback?.cancel()
        return undefined
      })

    let code
    try {
      const callbackResult = await callback?.wait()
      if (callbackResult?.code) {
        code = callbackResult.code
      } else {
        const manualInput = await manualPromise
        if (manualError) throw manualError
        const parsed = parseGoogleOAuthInput(manualInput)
        if (parsed.error) throw new Error(`authorization failed: ${parsed.error}`)
        if (parsed.state && parsed.state !== verifier) throw new Error('state mismatch')
        code = parsed.code
      }
    } finally {
      manualAbort.abort()
    }

    if (!code) throw new Error('missing authorization code')

    session.notify({ message: 'Exchanging Google authorization code…' })
    const tokenResponse = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ANTIGRAVITY_REDIRECT_URI,
        code_verifier: verifier,
      }),
      signal,
    })
    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text().catch(() => '')
      throw new Error(`Google token exchange failed (${tokenResponse.status}): ${errText}`)
    }
    const tokenData = await tokenResponse.json()
    if (!tokenData?.access_token || !tokenData?.refresh_token) {
      throw new Error('Google token exchange missing refresh_token; please retry and grant consent')
    }

    session.notify({ message: 'Fetching Google account info…' })
    const [email, projectId] = await Promise.all([
      fetchGoogleEmail(tokenData.access_token, fetchImpl, signal),
      discoverAntigravityProject(tokenData.access_token, fetchImpl, signal),
    ])

    const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600
    const expires = Date.now() + expiresIn * 1000 - TOKEN_REFRESH_BUFFER_MS
    await session.commit({
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: tokenData.access_token,
        refresh: tokenData.refresh_token,
        expires,
        projectId,
        ...(email ? { email } : {}),
      },
    })
  } finally {
    callback?.close()
  }
}

/**
 * Resolves a valid Antigravity `{ access, projectId }`, refreshing the stored
 * Google OAuth token inside `credentials.modifyRecord()` when expired.
 */
export async function resolveAntigravityGrant(credentials, key, fetchImpl = globalThis.fetch, signal) {
  if (!credentials) throw new Error('OAuth refresh failed for google-antigravity: credentials service absent')
  const current = await credentials.readRecord(key)
  if (current?.kind !== 'grant' || !isObject(current.payload) || typeof current.payload.refresh !== 'string' || !current.payload.refresh) {
    throw new Error('OAuth refresh failed for google-antigravity: not signed in')
  }
  const p = current.payload
  if (typeof p.access === 'string' && p.access.length > 0 && typeof p.expires === 'number' && p.expires > Date.now() + TOKEN_VALIDITY_MARGIN_MS) {
    return {
      access: p.access,
      projectId: typeof p.projectId === 'string' && p.projectId.length > 0 ? p.projectId : DEFAULT_PROJECT_ID,
    }
  }

  let resolved
  await credentials.modifyRecord(key, async (latest) => {
    if (latest?.kind !== 'grant' || !isObject(latest.payload) || typeof latest.payload.refresh !== 'string' || !latest.payload.refresh) {
      throw new Error('OAuth refresh failed for google-antigravity: grant missing')
    }
    const lp = latest.payload
    if (typeof lp.access === 'string' && lp.access.length > 0 && typeof lp.expires === 'number' && lp.expires > Date.now() + TOKEN_VALIDITY_MARGIN_MS) {
      resolved = {
        access: lp.access,
        projectId: typeof lp.projectId === 'string' && lp.projectId.length > 0 ? lp.projectId : DEFAULT_PROJECT_ID,
      }
      return latest
    }

    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: lp.refresh,
        grant_type: 'refresh_token',
      }),
      signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`OAuth refresh failed for google-antigravity (${response.status}): ${errText}`)
    }
    const data = await response.json()
    if (!data?.access_token) {
      throw new Error('OAuth refresh failed for google-antigravity: missing access_token')
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
    const nextExpires = Date.now() + expiresIn * 1000 - TOKEN_REFRESH_BUFFER_MS
    const projectId = typeof lp.projectId === 'string' && lp.projectId.length > 0
      ? lp.projectId
      : await discoverAntigravityProject(data.access_token, fetchImpl, signal)
    const nextPayload = {
      ...lp,
      type: 'oauth',
      access: data.access_token,
      refresh: data.refresh_token || lp.refresh,
      expires: nextExpires,
      projectId,
    }
    resolved = { access: nextPayload.access, projectId }
    return { kind: 'grant', payload: nextPayload }
  })
  return resolved
}

/**
 * Queries Antigravity quota via `v1internal:fetchAvailableModels` and maps
 * per-family `remainingFraction` into `appAuth/usage` windows.
 */
export async function queryAntigravityUsage(access, projectId, fetchImpl = globalThis.fetch) {
  const result = (status, reason) => ({
    provider: ANTIGRAVITY_PROVIDER_ID,
    status,
    windows: [],
    ...(reason ? { reason } : {}),
  })
  const headers = {
    Authorization: `Bearer ${access}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...antigravityHeaders(),
  }
  let response
  for (const endpoint of [ANTIGRAVITY_ENDPOINTS[0], ANTIGRAVITY_ENDPOINTS[2]]) {
    try {
      const candidate = await fetchImpl(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: projectId || DEFAULT_PROJECT_ID }),
        signal: AbortSignal.timeout(10_000),
      })
      if (candidate.ok) {
        response = candidate
        break
      }
      candidate.body?.cancel().catch(() => {})
      if (candidate.status === 401) return result('unavailable', 'auth_required')
      if (candidate.status === 429) return result('unavailable', 'rate_limited')
      if (candidate.status !== 403 && candidate.status !== 404) {
        return result('unavailable', 'invalid_response')
      }
      response = candidate
    } catch {
      return result('unavailable', 'network')
    }
  }
  if (!response?.ok) {
    return result('unavailable', response?.status === 403 ? 'permission_denied' : 'invalid_response')
  }

  let data
  try {
    data = await response.json()
  } catch {
    return result('unavailable', 'invalid_response')
  }
  const models = isObject(data?.models) ? data.models : undefined
  if (!models) return result('unsupported')

  const buckets = new Map()
  for (const [id, info] of Object.entries(models)) {
    const quota = info?.quotaInfo
    if (!isObject(quota) || typeof quota.remainingFraction !== 'number' || !Number.isFinite(quota.remainingFraction)) continue
    const clampedRemaining = Math.max(0, Math.min(1, quota.remainingFraction))
    const usedPercent = Math.round((1 - clampedRemaining) * 1000) / 10
    const family = id.startsWith('claude-') ? 'claude' : id.startsWith('gemini-') ? 'gemini' : 'gpt_oss'
    const resetAt = typeof quota.resetTime === 'string' && !Number.isNaN(Date.parse(quota.resetTime))
      ? new Date(quota.resetTime).toISOString()
      : null
    const existing = buckets.get(family)
    if (!existing || usedPercent > existing.usedPercent) {
      buckets.set(family, { id: family, usedPercent, resetAt })
    }
  }

  if (buckets.size === 0) return result('unsupported')
  return {
    provider: ANTIGRAVITY_PROVIDER_ID,
    status: 'ok',
    windows: [...buckets.values()],
  }
}

// ── Cloud Code Assist protocol translation & streaming ────────────────────────

function isGemini3Pro(modelId) {
  return /gemini-3(?:\.\d+)?-pro/.test(modelId.toLowerCase())
}

function isGemini3Flash(modelId) {
  return /gemini-3(?:\.\d+)?-flash/.test(modelId.toLowerCase())
}

function isGemini3(modelId) {
  return isGemini3Pro(modelId) || isGemini3Flash(modelId)
}

function getGeminiMajorVersion(modelId) {
  const match = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/)
  return match ? Number.parseInt(match[1], 10) : undefined
}

function requiresToolCallId(modelId) {
  const major = getGeminiMajorVersion(modelId)
  return modelId.startsWith('claude-') || modelId.startsWith('gpt-oss-') || (major !== undefined && major >= 3)
}

function supportsMultimodalFunctionResponse(modelId) {
  const major = getGeminiMajorVersion(modelId)
  return major === undefined || major >= 3
}

const BASE64_SIG_RE = /^[A-Za-z0-9+/]+={0,2}$/
function validThoughtSignature(sig) {
  return typeof sig === 'string' && sig.length > 0 && sig.length % 4 === 0 && BASE64_SIG_RE.test(sig)
}

function sanitizeSurrogates(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (isObject(parsed)) return parsed
  } catch {}
  return {}
}

const JSON_SCHEMA_META = new Set(['$schema', '$id', '$anchor', '$dynamicAnchor', '$vocabulary', '$comment', '$defs', 'definitions'])
const JSON_SCHEMA_NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'])
const JSON_SCHEMA_SUBSCHEMAS = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'prefixItems',
  'additionalItems', 'unevaluatedItems', 'contains', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'contentSchema',
])

function sanitizeForOpenApi(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeForOpenApi)
  if (!isObject(schema)) return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (!JSON_SCHEMA_META.has(k)) out[k] = sanitizeForOpenApi(v)
  }
  return out
}

function rewriteConstAsEnum(schema, isNameMap = false) {
  if (Array.isArray(schema)) return schema.map((item) => rewriteConstAsEnum(item))
  if (!isObject(schema)) return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (isNameMap || JSON_SCHEMA_SUBSCHEMAS.has(k)) out[k] = rewriteConstAsEnum(v, false)
    else if (JSON_SCHEMA_NAME_MAPS.has(k)) out[k] = rewriteConstAsEnum(v, true)
    else out[k] = v
  }
  if (!isNameMap && 'const' in out && out.enum === undefined) {
    const val = out.const
    if (typeof val === 'string' || typeof val === 'number') {
      delete out.const
      out.enum = [val]
    }
  }
  return out
}

function convertTools(tools, modelId) {
  const active = (tools ?? []).filter((t) => t.deferLoading !== true)
  if (active.length === 0) return undefined
  const useParameters = modelId.startsWith('claude-')
  return [{
    functionDeclarations: active.map((tool) => ({
      name: tool.name,
      description: tool.description,
      ...(useParameters
        ? { parameters: sanitizeForOpenApi(tool.parameters) }
        : { parametersJsonSchema: rewriteConstAsEnum(tool.parameters) }),
    })),
  }]
}

function readReplayMeta(message, modelId) {
  const state = message.source?.replayState
  if (!isObject(state) || !isObject(state.response) || !Array.isArray(state.blocks)) return undefined
  if (state.response.kind !== 'antigravity' || state.response.version !== 1) return undefined
  if (message.source?.provider !== ANTIGRAVITY_PROVIDER_ID || state.response.model !== modelId) return undefined
  if (state.blocks.length !== message.content.length) return undefined
  return state.blocks
}

function normalizeCallId(id, modelId) {
  if (!requiresToolCallId(modelId)) return id
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

function buildContentsAndSystem({ options, model, requestImages, resolveImageAccess, llmHelpers }) {
  const systemParts = []
  if (typeof options.system === 'string' && options.system.length > 0) systemParts.push(options.system)
  let start = 0
  for (const msg of options.messages) {
    if (msg.role !== 'system') break
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    if (text.length > 0) systemParts.push(text)
    start++
  }

  const contents = []
  const toolNames = new Map()
  const toolIdMap = new Map()
  const supportsImages = model.inputModalities.includes('image')

  for (const msg of options.messages.slice(start)) {
    if (msg.role === 'developer') {
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (text.length > 0) contents.push({ role: 'user', parts: [{ text: sanitizeSurrogates(text) }] })
      continue
    }
    if (msg.role === 'system') {
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (text.length > 0) {
        const escaped = text.replaceAll('</system-reminder>', '<\\/system-reminder>')
        contents.push({ role: 'user', parts: [{ text: `<system-reminder>\n${sanitizeSurrogates(escaped)}\n</system-reminder>` }] })
      }
      continue
    }
    if (msg.role === 'user') {
      const parts = []
      for (const block of msg.content) {
        if (block.type === 'text' && block.text.length > 0) {
          parts.push({ text: sanitizeSurrogates(block.text) })
        } else if (block.type === 'image' && supportsImages && requestImages) {
          const version = requestImages.get(block.attachment.attachmentId)
          if (version) {
            const handle = llmHelpers.requestImageHandleText(block.attachment, version, resolveImageAccess(block.attachment))
            if (handle) parts.push({ text: handle })
            parts.push({
              inlineData: {
                mimeType: version.mediaType,
                data: Buffer.from(version.data).toString('base64'),
              },
            })
          }
        }
      }
      if (parts.length > 0) contents.push({ role: 'user', parts })
      continue
    }
    if (msg.role === 'assistant') {
      const replayBlocks = readReplayMeta(msg, model.id)
      const parts = []
      msg.content.forEach((block, index) => {
        const meta = replayBlocks?.[index]
        if (block.type === 'text') {
          const sig = validThoughtSignature(meta?.thoughtSignature) ? meta.thoughtSignature : undefined
          if ((!block.text || block.text.trim() === '') && !sig) return
          parts.push({
            text: sanitizeSurrogates(block.text),
            ...(sig ? { thoughtSignature: sig } : {}),
          })
        } else if (block.type === 'reasoning') {
          if (replayBlocks !== undefined) {
            const sig = validThoughtSignature(meta?.thoughtSignature) ? meta.thoughtSignature : undefined
            if ((!block.text || block.text.trim() === '') && !sig) return
            parts.push({
              thought: true,
              text: sanitizeSurrogates(block.text),
              ...(sig ? { thoughtSignature: sig } : {}),
            })
          } else if (block.text && block.text.trim() !== '') {
            parts.push({ text: sanitizeSurrogates(block.text) })
          }
        } else if (block.type === 'tool-call') {
          const normalizedId = normalizeCallId(block.id, model.id)
          toolNames.set(block.id, block.name)
          toolIdMap.set(block.id, normalizedId)
          const sig = validThoughtSignature(meta?.thoughtSignature) ? meta.thoughtSignature : undefined
          parts.push({
            functionCall: {
              name: block.name,
              args: parseJsonObject(block.arguments),
              ...(requiresToolCallId(model.id) ? { id: normalizedId } : {}),
            },
            ...(sig ? { thoughtSignature: sig } : {}),
          })
        }
      })
      if (parts.length > 0) contents.push({ role: 'model', parts })
      continue
    }
    if (msg.role === 'tool') {
      const textParts = []
      const imageParts = []
      for (const block of msg.content) {
        if (block.type === 'text' && block.text.length > 0) textParts.push(block.text)
        else if (block.type === 'image' && supportsImages && requestImages) {
          const version = requestImages.get(block.attachment.attachmentId)
          if (version) {
            imageParts.push({
              inlineData: {
                mimeType: version.mediaType,
                data: Buffer.from(version.data).toString('base64'),
              },
            })
          }
        }
      }
      const textResult = textParts.join('\n')
      const hasImages = imageParts.length > 0
      const multimodalToolResponse = supportsMultimodalFunctionResponse(model.id)
      const responseText = textResult.trim().length > 0 ? sanitizeSurrogates(textResult) : hasImages ? '(see attached image)' : '(no output)'
      const toolName = toolNames.get(msg.toolCallId) ?? 'unknown'
      const callId = toolIdMap.get(msg.toolCallId) ?? normalizeCallId(msg.toolCallId, model.id)
      const fnPart = {
        functionResponse: {
          name: toolName,
          response: msg.isError ? { error: responseText } : { output: responseText },
          ...(hasImages && multimodalToolResponse ? { parts: imageParts } : {}),
          ...(requiresToolCallId(model.id) ? { id: callId } : {}),
        },
      }
      const last = contents[contents.length - 1]
      if (last?.role === 'user' && last.parts?.some((p) => p.functionResponse)) {
        last.parts.push(fnPart)
      } else {
        contents.push({ role: 'user', parts: [fnPart] })
      }
      if (hasImages && !multimodalToolResponse) {
        contents.push({ role: 'user', parts: [{ text: 'Tool result image:' }, ...imageParts] })
      }
    }
  }

  const userSystem = systemParts.join('\n\n')
  const systemInstruction = {
    role: 'user',
    parts: [
      { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
      { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
      ...(userSystem ? [{ text: sanitizeSurrogates(userSystem) }] : []),
    ],
  }

  return { contents, systemInstruction }
}

function getGemini3ThinkingLevel(effort, modelId) {
  if (isGemini3Pro(modelId)) {
    return effort === 'minimal' || effort === 'low' ? 'LOW' : 'HIGH'
  }
  switch (effort) {
    case 'minimal': return 'MINIMAL'
    case 'low': return 'LOW'
    case 'medium': return 'MEDIUM'
    case 'high': return 'HIGH'
  }
}

function buildGeneratePayload({ model, projectId, options, contents, systemInstruction }) {
  const generationConfig = {}
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature
  let maxTokens = options.maxTokens ?? model.maxTokens
  const effort = options.reasoningEffort ?? model.defaultEffort
  if (model.reasoning && effort && effort !== 'off') {
    generationConfig.thinkingConfig = { includeThoughts: true }
    if (isGemini3(model.id)) {
      generationConfig.thinkingConfig.thinkingLevel = getGemini3ThinkingLevel(effort, model.id)
    } else {
      let budget = THINKING_BUDGETS[effort] ?? THINKING_BUDGETS.medium
      maxTokens = Math.min((options.maxTokens ?? model.maxTokens) + budget, model.maxTokens)
      if (maxTokens <= budget) budget = Math.max(0, maxTokens - 1024)
      generationConfig.thinkingConfig.thinkingBudget = budget
    }
  }
  if (maxTokens !== undefined) generationConfig.maxOutputTokens = maxTokens

  const request = {
    contents,
    systemInstruction,
    ...(options.sessionId !== undefined ? { sessionId: String(options.sessionId) } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  }
  const tools = convertTools(options.tools, model.id)
  if (tools) request.tools = tools

  return {
    project: projectId,
    model: model.id,
    request,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  }
}

function extractRetryDelayMs(errorText, response) {
  const normalize = (ms) => (ms > 0 ? Math.ceil(ms + 1000) : undefined)
  const retryAfter = response?.headers?.get?.('retry-after')
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs)) return normalize(secs * 1000)
    const ts = Date.parse(retryAfter)
    if (!Number.isNaN(ts)) return normalize(ts - Date.now())
  }
  const resetAfter = response?.headers?.get?.('x-ratelimit-reset-after')
  if (resetAfter) {
    const secs = Number(resetAfter)
    if (Number.isFinite(secs)) return normalize(secs * 1000)
  }
  const durationMatch = errorText.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i)
  if (durationMatch) {
    const h = durationMatch[1] ? Number.parseInt(durationMatch[1], 10) : 0
    const m = durationMatch[2] ? Number.parseInt(durationMatch[2], 10) : 0
    const s = Number.parseFloat(durationMatch[3])
    if (!Number.isNaN(s)) return normalize(((h * 60 + m) * 60 + s) * 1000)
  }
  const retryIn = errorText.match(/Please retry in ([0-9.]+)(ms|s)/i)
  if (retryIn?.[1]) {
    const val = Number.parseFloat(retryIn[1])
    if (!Number.isNaN(val) && val > 0) return normalize(retryIn[2].toLowerCase() === 'ms' ? val : val * 1000)
  }
  const jsonDelay = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i)
  if (jsonDelay?.[1]) {
    const val = Number.parseFloat(jsonDelay[1])
    if (!Number.isNaN(val) && val > 0) return normalize(jsonDelay[2].toLowerCase() === 'ms' ? val : val * 1000)
  }
  return undefined
}

function isRetryableStatus(status, errorText) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true
  return /resource.?exhausted|rate.?limit|overloaded|service.?unavailable|other.?side.?closed/i.test(errorText)
}

function extractApiErrorMessage(errorText) {
  try {
    const parsed = JSON.parse(errorText)
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.length > 0) return parsed.error.message
  } catch {}
  return errorText
}

function classifyFailureCode(status, message, llmHelpers) {
  if (status === 401 || status === 403 || /\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (llmHelpers.isContextWindowExceededError(message)) return llmHelpers.CONTEXT_WINDOW_EXCEEDED_CODE
  if (llmHelpers.isQuotaExceededError(message)) return llmHelpers.QUOTA_EXCEEDED_CODE
  if (status === 429 || /\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  if (status === 400 || status === 413 || /\b(?:400|413)\b|invalid.?request|payload too large/i.test(message)) return 'INVALID_REQUEST'
  if ((status !== undefined && status >= 500) || /\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message)) return 'TRANSPORT'
  return 'ANTIGRAVITY_ERROR'
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function requestImageDimensions(width, height, maxPixels) {
  if (!width || !height || width * height <= maxPixels) return { width, height }
  const scale = Math.sqrt(maxPixels / (width * height))
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

/**
 * Creates the `LlmAdapter` for `google-antigravity`, handling Google OAuth
 * refresh, multimodal inputs, tool calls, reasoning, and thought-signature replay.
 */
export function createAntigravityAdapter({
  LlmAdapter,
  LlmError,
  llmHelpers,
  getCredentials,
  getAttachments,
  getFs,
  recordKey,
  fetch = globalThis.fetch,
}) {
  let toolCallSeq = 0

  function getModelOrThrow(modelId) {
    const model = MODEL_MAP.get(modelId)
    if (!model) throw new LlmError(`antigravity provider has no model "${modelId}"`, 'UNKNOWN_MODEL')
    return model
  }

  function toResolvedModelInfo(model) {
    return {
      provider: ANTIGRAVITY_PROVIDER_ID,
      id: model.id,
      name: model.name,
      inputModalities: [...model.inputModalities],
      context: { contextWindow: model.contextWindow },
      defaultMaxTokens: model.maxTokens,
      ...(model.reasoning && model.efforts.length > 0
        ? {
            reasoning: {
              efforts: model.efforts.map((id) => ({ id, name: EFFORT_LABELS[id] ?? id })),
              ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
            },
          }
        : {}),
    }
  }

  async function* streamCall(options, model) {
    if (options.stop !== undefined) {
      throw new LlmError('antigravity adapter does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    if (model.reasoning) {
      const effort = options.reasoningEffort ?? model.defaultEffort
      if (effort !== undefined && !model.efforts.includes(effort)) {
        throw new LlmError(`antigravity model "${model.id}" does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
      }
    } else if (options.reasoningEffort !== undefined) {
      throw new LlmError(`antigravity model "${model.id}" does not support reasoning effort "${options.reasoningEffort}"`, 'UNSUPPORTED_REASONING_EFFORT')
    }

    const { access, projectId } = await resolveAntigravityGrant(getCredentials(), recordKey, fetch, options.signal)

    const hasImages = options.messages.some((m) => llmHelpers.contentHasImage(m.content))
    let exactMessages = options.messages
    let requestImages
    const resolveImageAccess = (ref) =>
      llmHelpers.resolveImageAttachmentAccess(getAttachments(), (hostPath) => getFs()?.processPathFromHostPath(hostPath), ref)

    if (hasImages && model.inputModalities.includes('image')) {
      const attachments = getAttachments()
      if (!attachments) throw new LlmError('antigravity image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      const refs = new Map()
      for (const message of options.messages) {
        for (const block of message.content) {
          if (block.type === 'image' && block.offloaded !== true) {
            refs.set(block.attachment.attachmentId, block.attachment)
          }
        }
      }
      const ordered = [...refs.values()]
      const prepared = await Promise.all(
        ordered.map((ref) =>
          attachments.readImageRequest(
            ref,
            { ...requestImageDimensions(ref.width, ref.height, REQUEST_IMAGE_PIXEL_BUDGET), maxBytes: REQUEST_IMAGE_MAX_BYTES },
            options.signal,
          ),
        ),
      )
      requestImages = new Map(ordered.map((ref, i) => [ref.attachmentId, prepared[i]]))
      const offloadCount = llmHelpers.requiredImageOffload(
        options.messages,
        { representation: 'base64', maxBytes: MAX_REQUEST_IMAGE_BYTES, maxImages: MAX_REQUEST_IMAGES },
        (block) => requestImages.get(block.attachment.attachmentId).bytes,
      )
      if (offloadCount > 0) {
        throw new LlmError(
          `antigravity request images exceed the route image budget; ${offloadCount} more oldest occurrence(s) must be offloaded.`,
          llmHelpers.IMAGE_OFFLOAD_REQUIRED_CODE,
          { offloadImages: offloadCount },
        )
      }
      exactMessages = llmHelpers.projectOffloadedImages(options.messages, (ref) => llmHelpers.offloadedImageText(ref, resolveImageAccess(ref)))
    }

    const { contents, systemInstruction } = buildContentsAndSystem({
      options: { ...options, messages: exactMessages },
      model,
      requestImages,
      resolveImageAccess,
      llmHelpers,
    })

    const payload = buildGeneratePayload({ model, projectId, options, contents, systemInstruction })
    const bodyJson = JSON.stringify(payload)
    const headers = {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...antigravityHeaders(),
      ...(model.id.startsWith('claude-') && model.reasoning ? { 'anthropic-beta': CLAUDE_THINKING_BETA_HEADER } : {}),
    }

    let response
    let endpointIndex = 0
    let requestUrl
    let lastError
    let lastStatus

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) throw new LlmError('antigravity request aborted by caller', 'ABORTED')
      const endpoint = ANTIGRAVITY_ENDPOINTS[endpointIndex]
      requestUrl = `${endpoint}/v1internal:streamGenerateContent?alt=sse`
      try {
        response = await fetch(requestUrl, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal: options.signal,
        })
        if (response.ok) break
        lastStatus = response.status
        const errorText = await response.text().catch(() => '')
        if ((response.status === 403 || response.status === 404) && endpointIndex < ANTIGRAVITY_ENDPOINTS.length - 1) {
          endpointIndex++
          continue
        }
        if (attempt < MAX_RETRIES && isRetryableStatus(response.status, errorText)) {
          if (endpointIndex < ANTIGRAVITY_ENDPOINTS.length - 1) endpointIndex++
          const serverDelay = extractRetryDelayMs(errorText, response)
          if (serverDelay && serverDelay > MAX_RETRY_DELAY_MS) {
            throw new LlmError(
              `Server requested ${Math.ceil(serverDelay / 1000)}s retry delay: ${extractApiErrorMessage(errorText)}`,
              classifyFailureCode(response.status, errorText, llmHelpers),
              { status: response.status, providerRetryAfterMs: serverDelay },
            )
          }
          await sleep(serverDelay ?? BASE_DELAY_MS * 2 ** attempt, options.signal)
          continue
        }
        const msg = `Cloud Code Assist API error (${response.status}): ${extractApiErrorMessage(errorText)}`
        throw new LlmError(msg, classifyFailureCode(response.status, msg, llmHelpers), { status: response.status })
      } catch (error) {
        if (error instanceof LlmError) throw error
        if (options.signal?.aborted || error?.name === 'AbortError') {
          throw new LlmError('antigravity request aborted by caller', 'ABORTED', { cause: error })
        }
        lastError = error
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** attempt, options.signal)
          continue
        }
        throw new LlmError(error?.message || 'Network error', 'TRANSPORT', { cause: error })
      }
    }

    if (!response?.ok) {
      throw new LlmError(lastError?.message || `Antigravity request failed (${lastStatus ?? 'unknown'})`, 'TRANSPORT', { cause: lastError })
    }

    for (let emptyAttempt = 0; emptyAttempt <= MAX_EMPTY_STREAM_RETRIES; emptyAttempt++) {
      let currentResponse = response
      if (emptyAttempt > 0) {
        await sleep(EMPTY_STREAM_BASE_DELAY_MS * 2 ** (emptyAttempt - 1), options.signal)
        currentResponse = await fetch(requestUrl, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal: options.signal,
        })
        if (!currentResponse.ok) {
          const retryErr = await currentResponse.text().catch(() => '')
          const msg = `Cloud Code Assist API error (${currentResponse.status}): ${extractApiErrorMessage(retryErr)}`
          throw new LlmError(msg, classifyFailureCode(currentResponse.status, msg, llmHelpers), { status: currentResponse.status })
        }
      }

      const outcome = yield* readSseAttempt(currentResponse, options.signal)
      if (outcome.hasContent) {
        yield { type: 'usage', usage: outcome.usage }
        if (outcome.stopReason === 'error') {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: { message: `antigravity response ended with finishReason ${outcome.rawFinishReason}`, code: 'ANTIGRAVITY_ERROR' },
            },
          }
          return
        }
        yield {
          type: 'finish',
          reason: { kind: outcome.stopReason },
          replayState: {
            response: { kind: 'antigravity', version: 1, model: model.id },
            blocks: outcome.replayBlocks,
          },
        }
        return
      }
    }

    throw new LlmError('Cloud Code Assist API returned an empty response', llmHelpers.EMPTY_RESPONSE_CODE)
  }

  async function* readSseAttempt(response, signal) {
    if (!response.body) throw new LlmError('No response body from Antigravity API', 'TRANSPORT')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const onAbort = () => void reader.cancel().catch(() => {})
    signal?.addEventListener('abort', onAbort, { once: true })

    let buffer = ''
    let nextIndex = 0
    let activeBlock = null
    let hasContent = false
    let hasToolCalls = false
    let rawFinishReason
    let stopReason = 'stop'
    let usage = { inputTokens: 0, outputTokens: 0 }
    const replayBlocks = []

    const flushActive = () => {
      if (!activeBlock) return null
      const finished = activeBlock
      activeBlock = null
      replayBlocks.push(finished.sig ? { thoughtSignature: finished.sig } : {})
      return {
        type: 'block-end',
        index: finished.index,
        block: finished.kind === 'reasoning' ? { type: 'reasoning', text: finished.text } : { type: 'text', text: finished.text },
      }
    }

    try {
      while (true) {
        if (signal?.aborted) throw new LlmError('antigravity request aborted by caller', 'ABORTED')
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.trimEnd()
          if (!line.startsWith('data:')) continue
          const jsonStr = line.slice(5).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue
          let chunk
          try { chunk = JSON.parse(jsonStr) } catch { continue }
          const responseData = chunk?.response
          if (!responseData) continue

          const candidate = responseData.candidates?.[0]
          if (Array.isArray(candidate?.content?.parts)) {
            for (const part of candidate.content.parts) {
              if (part.text !== undefined) {
                hasContent = true
                const kind = part.thought === true ? 'reasoning' : 'text'
                if (!activeBlock || activeBlock.kind !== kind) {
                  const ended = flushActive()
                  if (ended) yield ended
                  const index = nextIndex++
                  activeBlock = { kind, index, text: '', sig: undefined }
                  yield { type: 'block-start', index, blockType: kind }
                }
                activeBlock.text += part.text
                if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0) {
                  activeBlock.sig = part.thoughtSignature
                }
                if (part.text.length > 0) {
                  yield {
                    type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta',
                    index: activeBlock.index,
                    text: part.text,
                  }
                }
              }
              if (part.functionCall) {
                hasContent = true
                hasToolCalls = true
                const ended = flushActive()
                if (ended) yield ended

                const index = nextIndex++
                const id = part.functionCall.id || `${part.functionCall.name || 'tool'}_${Date.now()}_${++toolCallSeq}`
                const name = part.functionCall.name || ''
                const argsJson = JSON.stringify(part.functionCall.args ?? {})
                replayBlocks.push(
                  typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0
                    ? { thoughtSignature: part.thoughtSignature }
                    : {},
                )

                yield { type: 'block-start', index, blockType: 'tool-call' }
                yield { type: 'tool-call-delta', index, id, name, argumentsDelta: argsJson }
                yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argsJson } }
              }
            }
          }

          if (candidate?.finishReason) {
            rawFinishReason = candidate.finishReason
            if (hasToolCalls) stopReason = 'tool-calls'
            else if (candidate.finishReason === 'MAX_TOKENS') stopReason = 'max-tokens'
            else if (candidate.finishReason === 'STOP') stopReason = 'stop'
            else stopReason = 'error'
          }

          if (responseData.usageMetadata) {
            const um = responseData.usageMetadata
            const promptTokens = um.promptTokenCount || 0
            const cacheReadTokens = um.cachedContentTokenCount || 0
            const reasoningTokens = um.thoughtsTokenCount || 0
            const outputTokens = (um.candidatesTokenCount || 0) + reasoningTokens
            usage = {
              inputTokens: Math.max(0, promptTokens - cacheReadTokens),
              outputTokens,
              ...(um.totalTokenCount > 0 ? { totalTokens: um.totalTokenCount } : {}),
              ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
              ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
            }
          }
        }
      }

      const tail = flushActive()
      if (tail) yield tail
      if (hasToolCalls) stopReason = 'tool-calls'
      return { hasContent, stopReason, rawFinishReason, usage, replayBlocks }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      reader.releaseLock()
    }
  }

  return class AntigravityAdapter extends LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: ANTIGRAVITY_DISPLAY_NAME }
    }

    imageRequestTarget(_provider, _model, image) {
      return {
        ...requestImageDimensions(image.width, image.height, REQUEST_IMAGE_PIXEL_BUDGET),
        maxBytes: REQUEST_IMAGE_MAX_BYTES,
      }
    }

    async listModels(provider) {
      const record = await getCredentials()?.readRecord(recordKey)
      if (record?.kind !== 'grant') return []
      return ANTIGRAVITY_MODELS.map((m) => ({
        provider,
        id: m.id,
        name: m.name,
        inputModalities: [...m.inputModalities],
      }))
    }

    async resolveModel(_provider, modelId) {
      return toResolvedModelInfo(getModelOrThrow(modelId))
    }

    async prepareCall(_provider, modelId) {
      const model = getModelOrThrow(modelId)
      return {
        model: toResolvedModelInfo(model),
        stream: (options) => streamCall(options, model),
      }
    }

    stream(options) {
      const model = getModelOrThrow(options.model)
      return streamCall(options, model)
    }
  }
}
