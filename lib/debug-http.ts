import http from 'node:http'
import https from 'node:https'
import {EventEmitter} from 'node:events'

const failUrl = 'http://127.0.0.2'
const debugHttp = true
const debugHttpTime = true

const originalEmit = EventEmitter.prototype.emit

if (debugHttp) {
  const originalHttpRequest = http.request
  http.request = function (this: unknown, ...args: unknown[]) {
    if (typeof args[0] === 'string' && !args[0].startsWith(failUrl)) {
      console.log('http.request', args[0])
    }
    return (originalHttpRequest as (...a: unknown[]) => http.ClientRequest).apply(this as unknown as object, args)
  } as typeof http.request

  const originalHttpsRequest = https.request
  https.request = function (this: unknown, ...args: unknown[]) {
    if (typeof args[0] === 'string' && !args[0].startsWith(failUrl)) {
      console.log('https.request', args[0])
    }
    return (originalHttpsRequest as (...a: unknown[]) => http.ClientRequest).apply(this as unknown as object, args)
  } as typeof https.request

  if (globalThis.fetch) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async function (...args: Parameters<typeof fetch>) {
      const url = args[0]
      if (typeof url === 'string' && !url.startsWith(failUrl)) {
        console.log('fetch', url)
      }
      return originalFetch.apply(this, args)
    }
  }

  EventEmitter.prototype.emit = function (event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'request') {
      console.log(`emit('request')`, args)
    }
    return originalEmit.call(this, event, ...args)
  }
}

if (debugHttpTime) {
  const originalHttpRequest = http.request
  http.request = function (this: unknown, ...args: unknown[]) {
    const req = (originalHttpRequest as (...a: unknown[]) => http.ClientRequest).apply(this as unknown as object, args)
    if (typeof args[0] === 'string' && !args[0].startsWith(failUrl)) {
      const startTime = Date.now()
      req.on('response', () => {
        const durationSeconds = (Date.now() - startTime) / 1000
        console.log('https.request', args[0], durationSeconds + 's')
      })
    }
    return req
  } as typeof http.request

  const originalHttpsRequest = https.request
  https.request = function (this: unknown, ...args: unknown[]) {
    const req = (originalHttpsRequest as (...a: unknown[]) => http.ClientRequest).apply(this as unknown as object, args)
    if (typeof args[0] === 'string' && !args[0].startsWith(failUrl)) {
      const startTime = Date.now()
      req.on('response', () => {
        const durationSeconds = (Date.now() - startTime) / 1000
        console.log('https.request', args[0], durationSeconds + 's')
      })
    }
    return req
  } as typeof https.request

  if (globalThis.fetch) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async function (...args: Parameters<typeof fetch>) {
      const startTime = Date.now()
      const originalResponse = await originalFetch.apply(this, args)

      const response = new Response(originalResponse.body, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: originalResponse.headers,
      })
      Object.defineProperties(response, {
        ok: {value: originalResponse.ok},
        redirected: {value: originalResponse.redirected},
        type: {value: originalResponse.type},
        url: {value: originalResponse.url},
      })
      let body: string | undefined
      const readBody = async (): Promise<string> => {
        if (body !== undefined) {
          return body
        }
        body = await originalResponse.text()
        const totalTimeSeconds = (Date.now() - startTime) / 1000
        console.log('fetch', args[0], totalTimeSeconds + 's')
        return body
      }
      response.text = async () => readBody()
      response.json = async () => JSON.parse(await readBody())
      return response
    }
  }

  EventEmitter.prototype.emit = function (event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'request') {
      console.log(`emit('request')`, args)
    }
    return originalEmit.call(this, event, ...args)
  }
}
