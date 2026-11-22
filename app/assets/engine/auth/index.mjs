// SPDX-License-Identifier: MIT
//
// dsh-app auth bridge: DSH plugin that exposes subscription sign-in (ChatGPT,
// Claude) to the app as the `appAuth` Remote service:
//
//   appAuth/list                  → {providers: [{id, signedIn, account?}]}
//   appAuth/usage {provider}      → {provider, status, windows, plan?}
//   appAuth/begin  {provider}     → {attemptId}
//   appAuth/poll   {attemptId}    → {phase, url?, userCode?, message?, placeholder?, error?}
//   appAuth/answer {attemptId, value} → {}
//   appAuth/cancel {attemptId}    → {}
//   appAuth/signOut {provider}    → {}
//
// The app writes this directory into the guest (/opt/dsh-app/auth/) at every
// engine start and mounts it with an extra `--patch` overlay that inserts this
// file by absolute path; the logic lives in bridge.mjs.
//
// Wiring notes (DSH 0.2.1-rc.2):
// - The Gateway serves a service without a generated Typert descriptor through
//   its source-mode fallback: it finds the `typertRemote` binding of a
//   TypertRemoteService, reads the methods marked with `Remote`, and takes the
//   wire argument names from the method signatures. So the methods below take
//   plain identifier parameters whose names are the wire names.
// - Node has no decorator syntax, so `Remote` is applied the way compiled
//   decorators apply it: once per method, with its initializer run in the
//   constructor.
// - This file lives outside DSH's install and profiles, so bare imports would
//   not resolve; the host's own copy of the protocol package is loaded from the
//   running DSH install instead (same file, same module instance).

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import {
  ANTIGRAVITY_DISPLAY_NAME,
  ANTIGRAVITY_PROVIDER_ID,
  createAntigravityAdapter,
  runAntigravityOAuthFlow,
} from './antigravity.mjs'
import { AuthBridge, recordKeyFor } from './bridge.mjs'

/** Where the dsh-app rootfs installs DSH (the `dsh` shim runs this file). */
const GUEST_DSH_BIN = '/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'

/** Imports a package from the running DSH install. */
async function hostImport(specifier) {
  const anchors = [process.argv[1], GUEST_DSH_BIN].filter((anchor) => typeof anchor === 'string' && anchor.length > 0)
  const failures = []
  for (const anchor of anchors) {
    try {
      return await import(pathToFileURL(createRequire(anchor).resolve(specifier)).href)
    } catch (error) {
      failures.push(`${anchor}: ${error?.code ?? error?.message ?? error}`)
    }
  }
  try {
    return await import(specifier)
  } catch (error) {
    failures.push(`bare: ${error?.code ?? error?.message ?? error}`)
  }
  throw new Error(`dsh-app auth: cannot load ${specifier} from the DSH install (${failures.join('; ')})`)
}

const { TypertRemoteService, Remote, RemoteError } = await hostImport('@deepseek-ai/dsh-typert-protocol')
const llmPkg = await hostImport('@deepseek-ai/dsh-llm')

/** The Remote methods, by implementation name (= wire method name). */
const REMOTE_METHODS = ['list', 'usage', 'begin', 'poll', 'answer', 'cancel', 'signOut']
const markRemoteMethods = []

export default class AppAuth extends TypertRemoteService {
  // credentials: grants are read and deleted here. authorization: the flows
  // llm-pi-ai registers. settings and llm are optional and looked up per call / inject.
  static inject = ['credentials', 'authorization']

  /** @param ctx - plugin context. */
  constructor(ctx) {
    super(ctx, 'appAuth')
    for (const mark of markRemoteMethods) mark.call(this)

    const antigravityKey = recordKeyFor(ANTIGRAVITY_PROVIDER_ID)
    if (ctx.authorization.describe(antigravityKey) === undefined) {
      ctx.authorization.registerFlow({
        key: antigravityKey,
        label: ANTIGRAVITY_DISPLAY_NAME,
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        run: (session) => runAntigravityOAuthFlow(session),
      })
    }

    let syncAntigravity = () => {}
    let desiredAntigravity

    this.bridge = new AuthBridge({
      get: (name) => ctx.get(name),
      RemoteError,
      onRouteChange: (provider, active) => {
        if (provider === ANTIGRAVITY_PROVIDER_ID) {
          desiredAntigravity = active
          syncAntigravity(active)
        }
      },
    })
    ctx.effect(() => () => this.bridge.dispose(), 'appAuth: sign-in attempts')

    ctx.inject(['llm'], (child) => {
      const AntigravityAdapter = createAntigravityAdapter({
        LlmAdapter: llmPkg.LlmAdapter,
        LlmError: llmPkg.LlmError,
        llmHelpers: llmPkg,
        getCredentials: () => ctx.get('credentials'),
        getAttachments: () => ctx.get('attachments'),
        getFs: () => ctx.get('fs'),
        recordKey: antigravityKey,
      })
      const adapter = new AntigravityAdapter()
      let registration
      let disposed = false

      syncAntigravity = (active) => {
        if (disposed) return
        if (active) {
          if (registration === undefined) {
            registration = child.llm.registerAdapter([ANTIGRAVITY_PROVIDER_ID], adapter)
          }
        } else if (registration !== undefined) {
          registration()
          registration = undefined
        }
      }

      child.effect(() => () => {
        disposed = true
        syncAntigravity = () => {}
        if (registration !== undefined) {
          registration()
          registration = undefined
        }
      }, 'appAuth: antigravity adapter')

      if (desiredAntigravity !== undefined) {
        syncAntigravity(desiredAntigravity)
      } else {
        Promise.resolve(ctx.credentials.readRecord(antigravityKey))
          .then((record) => {
            if (!disposed && desiredAntigravity === undefined && record?.kind === 'grant') {
              syncAntigravity(true)
            }
          })
          .catch(() => {})
      }
    })
  }

  list() {
    return this.bridge.list()
  }

  usage(provider) {
    return this.bridge.usage(provider)
  }

  begin(provider) {
    return this.bridge.begin(provider)
  }

  poll(attemptId) {
    return this.bridge.poll(attemptId)
  }

  answer(attemptId, value) {
    return this.bridge.answer(attemptId, value)
  }

  cancel(attemptId) {
    return this.bridge.cancel(attemptId)
  }

  signOut(provider) {
    return this.bridge.signOut(provider)
  }
}

for (const name of REMOTE_METHODS) {
  Remote(AppAuth.prototype[name], {
    kind: 'method',
    name,
    static: false,
    private: false,
    addInitializer: (initializer) => markRemoteMethods.push(initializer),
  })
}
