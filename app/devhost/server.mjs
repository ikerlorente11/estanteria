#!/usr/bin/env node
/**
 * The host, on the PC, for developing in Expo Go (which cannot run the native module): the same routes the
 * Kotlin host serves (see modules/estanteria-host/android/.../HostServer.kt), enough for the page to connect
 * and read online: settings (a JSON file here, the app password in the clear: development only), the service
 * proxied with the credential, info and the event stream. No shelf and no offline (those are native).
 *
 *   node devhost/server.mjs            # 127.0.0.1:48123, token "dev"
 *   adb reverse tcp:48123 tcp:48123    # the tablet reaches it at http://localhost:48123
 */
import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'

const PORT = Number(process.env.PORT || 48123)
const TOKEN = process.env.HOST_TOKEN || 'dev'
const FILE = join(dirname(fileURLToPath(import.meta.url)), 'settings.json')
const APP_VERSION = (() => { try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app.json'), 'utf8')).expo.version } catch (_) { return 'dev' } })()
const USER_AGENT = `LaEstanteria/${APP_VERSION} (Android)`
/** what /host/fetch never passes on (the connection's own, and the host's), and what it brings back of the answer */
const DROPPED = new Set(['host', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'transfer-encoding', 'content-length', 'accept-encoding', 'x-host-token', 'x-fetch-headers'])
const FORWARDED = ['content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control', 'www-authenticate', 'link', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-retry-after', 'dav']

function load() {
  const empty = { url: '', username: '', name: '', token: '' }
  try { return { ...empty, ...JSON.parse(readFileSync(FILE, 'utf8')) } } catch (_) { return empty }
}
function save(s) { writeFileSync(FILE, JSON.stringify(s, null, 2)) }
function describe(s) { return { url: s.url, username: s.username, name: s.name || '', hasToken: Boolean(s.token) } }
function authorization(s) { return s.username && s.token ? 'Basic ' + Buffer.from(`${s.username}:${s.token}`, 'utf8').toString('base64') : null }

const streams = new Set()
setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, 20000)

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
function body(req) {
  return new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))) })
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Host-Token, Range, X-Fetch-Headers')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY')
  res.setHeader('Access-Control-Expose-Headers', ['X-Fetch-Url', 'X-Fetch-Error', ...FORWARDED].join(', '))
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  console.log(new Date().toISOString().slice(11, 19), req.method, url.pathname)
  const given = req.headers['x-host-token'] || (String(req.headers.authorization || '').startsWith('Host ') ? req.headers.authorization.slice(5) : null) || url.searchParams.get('t')
  if (given !== TOKEN) return json(res, 401, { detail: 'falta el token del host' })
  const settings = load()
  try {
    if (url.pathname === '/host/info') return json(res, 200, { version: 'dev (PC)', shelf: false, offline: false })
    if (url.pathname === '/host/settings') {
      if (req.method === 'GET') return json(res, 200, describe(settings))
      if (req.method === 'PUT') {
        const b = JSON.parse((await body(req)).toString('utf8') || '{}')
        settings.url = (b.url ?? settings.url ?? '').replace(/\/+$/, '')
        settings.username = (b.username ?? settings.username).trim()
        settings.name = (b.name ?? settings.name ?? '').trim()
        if (b.token) settings.token = String(b.token).trim()
        save(settings)
        return json(res, 200, describe(settings))
      }
      if (req.method === 'DELETE') { Object.assign(settings, { url: '', username: '', name: '', token: '' }); save(settings); return json(res, 200, describe(settings)) }
    }
    if (url.pathname === '/host/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write('retry: 3000\n\n')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (url.pathname === '/host/fetch') return await fetchRoute(req, res, url)
    if (url.pathname === '/host/shelf/fetch' || url.pathname === '/host/shelf/save') return json(res, 501, { detail: 'En Expo Go no hay estantería del dispositivo: descargar y guardar archivos solo se puede en la app nativa.' })
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/opds/')) {
      const auth = authorization(settings)
      if (!auth || !settings.url) return json(res, 401, { detail: 'No hay ningún servidor propio conectado (Bibliotecas).' })
      const target = new URL(settings.url + url.pathname + url.search)
      const headers = { Authorization: auth }
      for (const h of ['content-type', 'accept', 'range']) if (req.headers[h]) headers[h] = req.headers[h]
      const data = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await body(req) : null
      if (data) headers['content-length'] = String(data.length)
      const make = target.protocol === 'https:' ? httpsRequest : httpRequest
      const up = make(target, { method: req.method, headers }, (r) => {
        const out = { 'Content-Type': r.headers['content-type'] || 'application/octet-stream' }
        for (const h of ['content-disposition', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'content-length']) if (r.headers[h]) out[h] = r.headers[h]
        res.writeHead(r.statusCode || 502, out)
        r.pipe(res)
      })
      up.on('error', (e) => json(res, 502, { detail: `Sin conexión con La Estantería: ${e.message}` }))
      if (data) up.write(data)
      return up.end()
    }
    if (url.pathname.startsWith('/host/shelf') || url.pathname.startsWith('/host/offline')) return json(res, 501, { detail: 'Solo en la app nativa.' })
    json(res, 404, { detail: `no existe ${url.pathname}` })
  } catch (e) {
    json(res, 500, { detail: e.message })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`host de desarrollo en http://127.0.0.1:${PORT} (token ${TOKEN}); ajustes en ${FILE}`))

/** `/host/fetch?url=`: any server, for the page (like Net.kt): the headers to send come as JSON in X-Fetch-Headers,
 * redirects are followed, and the answer comes back as the server gave it, with where it ended in X-Fetch-Url. */
async function fetchRoute(req, res, url) {
  const raw = url.searchParams.get('url') || ''
  let target
  try { target = new URL(raw) } catch (_) { return json(res, 400, { detail: raw ? `La dirección no es válida: ${raw}` : 'Falta la dirección que pedir (url).' }) }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return json(res, 400, { detail: 'Solo se pueden pedir direcciones http o https.' })
  let wanted = {}
  try { wanted = JSON.parse(req.headers['x-fetch-headers'] || '{}') } catch (_) { return json(res, 400, { detail: 'X-Fetch-Headers tiene que ser un objeto JSON.' }) }
  const headers = {}
  for (const [name, value] of Object.entries(wanted || {})) {
    const lower = name.toLowerCase()
    if (DROPPED.has(lower) || lower.startsWith('proxy-')) continue
    if (lower === 'authorization' && String(value).startsWith('Host ')) continue
    headers[name] = String(value)
  }
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'user-agent')) headers['User-Agent'] = USER_AGENT
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type') && req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
  const data = req.method === 'GET' || req.method === 'HEAD' ? null : await body(req)
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), 120000)
  let up
  try {
    up = await fetch(target, { method: req.method, headers, body: data && data.length ? data : undefined, redirect: 'follow', signal: stop.signal })
  } catch (e) {
    clearTimeout(timer)
    res.setHeader('X-Fetch-Error', '1')
    return json(res, 502, { detail: `Sin conexión con ${target.host}: ${e.cause?.message || e.message}` })
  }
  clearTimeout(timer)
  const out = { 'Content-Type': up.headers.get('content-type') || 'application/octet-stream', 'X-Fetch-Url': up.url || target.href }
  // fetch undoes gzip/br itself: the length the server said is then not that of what goes to the page
  if (up.headers.get('content-length') && !up.headers.get('content-encoding')) out['Content-Length'] = up.headers.get('content-length')
  for (const h of FORWARDED) if (up.headers.get(h)) out[h] = up.headers.get(h)
  res.writeHead(up.status, out)
  if (!up.body || req.method === 'HEAD') return res.end()
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res)
}
