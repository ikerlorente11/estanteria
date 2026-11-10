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

const PORT = Number(process.env.PORT || 48123)
const TOKEN = process.env.HOST_TOKEN || 'dev'
const DEFAULT_URL = 'https://estanteria.pistation.dev'
const FILE = join(dirname(fileURLToPath(import.meta.url)), 'settings.json')

function load() {
  try { return { url: DEFAULT_URL, username: '', token: '', ...JSON.parse(readFileSync(FILE, 'utf8')) } } catch (_) { return { url: DEFAULT_URL, username: '', token: '' } }
}
function save(s) { writeFileSync(FILE, JSON.stringify(s, null, 2)) }
function describe(s) { return { url: s.url, username: s.username, hasToken: Boolean(s.token) } }
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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Host-Token, Range')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Range, Accept-Ranges')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const given = req.headers['x-host-token'] || (String(req.headers.authorization || '').startsWith('Host ') ? req.headers.authorization.slice(5) : null) || url.searchParams.get('t')
  if (given !== TOKEN) return json(res, 401, { detail: 'falta el token del host' })
  const settings = load()
  try {
    if (url.pathname === '/host/info') return json(res, 200, { version: 'dev (PC)', shelf: false, offline: false })
    if (url.pathname === '/host/settings') {
      if (req.method === 'GET') return json(res, 200, describe(settings))
      if (req.method === 'PUT') {
        const b = JSON.parse((await body(req)).toString('utf8') || '{}')
        settings.url = (b.url || settings.url || DEFAULT_URL).replace(/\/+$/, '')
        settings.username = (b.username ?? settings.username).trim()
        if (b.token) settings.token = String(b.token).trim()
        save(settings)
        return json(res, 200, describe(settings))
      }
      if (req.method === 'DELETE') { settings.token = ''; save(settings); return json(res, 200, describe(settings)) }
    }
    if (url.pathname === '/host/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write('retry: 3000\n\n')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/opds/')) {
      const auth = authorization(settings)
      if (!auth) return json(res, 401, { detail: 'Conecta con tu Archivador primero.' })
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
