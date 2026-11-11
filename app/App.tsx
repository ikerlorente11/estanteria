import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Appearance, Dimensions, BackHandler, Linking, Platform, StatusBar as RNStatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { StatusBar } from 'expo-status-bar'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as SplashScreen from 'expo-splash-screen'
import * as NavigationBar from 'expo-navigation-bar'
import * as IntentLauncher from 'expo-intent-launcher'
import * as SystemUI from 'expo-system-ui'
import * as FileSystem from 'expo-file-system/legacy'

import EstanteriaHost from './modules/estanteria-host'

/**
 * La Estantería for Android: the shared viewer (built into the native module's assets) shown in a
 * web view, served by the app's own local server (modules/estanteria-host). This side only starts
 * that server, shows the page, handles the back button, keeps the screen on while reading and hands
 * the page the files other apps open with La Estantería.
 */
SplashScreen.preventAutoHideAsync().catch(() => {})

const DARK = '#141417'
const LIGHT = '#fafafc'

/** Downloads live in the app's own files (Android/data/<app>/files/descargas), like the OpenCloud app keeps its own:
 * nothing to choose, and they can be opened with another app from here. */
const DOWNLOADS = `${FileSystem.documentDirectory}descargas/`
function fileNameOf(raw: string): string { return raw.replace(/[\/:*?"<>|]+/g, '_') }
function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  return { pdf: 'application/pdf', epub: 'application/epub+zip', cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar',
    cb7: 'application/x-7z-compressed', zip: 'application/zip', rar: 'application/vnd.rar', mobi: 'application/x-mobipocket-ebook',
    azw: 'application/vnd.amazon.ebook', azw3: 'application/vnd.amazon.mobi8-ebook', prc: 'application/x-mobipocket-ebook',
    fb2: 'application/x-fictionbook+xml', fbz: 'application/x-zip-compressed-fb2', txt: 'text/plain', cbt: 'application/x-cbt',
    tar: 'application/x-tar', djvu: 'image/vnd.djvu' }[ext] || 'application/octet-stream'
}

// In development the page's console and errors come out here (Metro): the web view does not log them itself.
const DEV_CONSOLE = __DEV__ ? `(function () {
  var rn = window.ReactNativeWebView;
  function send(level, args) {
    try { rn.postMessage(JSON.stringify({ type: 'log', level: level, args: Array.prototype.map.call(args, function (x) {
      if (typeof x === 'string') return x;
      if (x && x.stack) return String(x.stack);
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }) })); } catch (e) {}
  }
  window.addEventListener('error', function (e) { send('error', [e.message + ' @ ' + e.filename + ':' + e.lineno]); });
  window.addEventListener('unhandledrejection', function (e) { send('error', ['unhandled: ' + (e.reason && e.reason.stack || e.reason)]); });
  ['log', 'info', 'warn', 'error'].forEach(function (k) { var o = console[k]; console[k] = function () { send(k, arguments); o.apply(console, arguments); }; });
})(); true;` : undefined

/** Which API path each downloaded file came from, so the page shows them as done from the start. */
const INDEX = `${FileSystem.documentDirectory}descargas-index.json`
async function readIndex(): Promise<Record<string, string>> {
  try { return JSON.parse(await FileSystem.readAsStringAsync(INDEX)) } catch (_) { return {} }
}
async function remember(path: string, name: string): Promise<void> {
  const index = await readIndex()
  index[path] = name
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(index)).catch(() => {})
}

export default function App() {
  const system = useColorScheme()
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')
  const scheme = theme === 'system' ? system : theme
  const [page, setPage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const web = useRef<React.ComponentRef<typeof WebView> | null>(null)
  const canGoBack = useRef(false)
  const pending = useRef<string[]>([])
  const ready = useRef(false)

  useEffect(() => {
    // Without the native module (Expo Go) the host is the development one on the PC (devhost/, through adb reverse).
    const started: Promise<{ url: string; token: string }> = EstanteriaHost
      ? EstanteriaHost.start()
      : process.env.EXPO_PUBLIC_HOST_URL
        ? Promise.resolve({ url: `${process.env.EXPO_PUBLIC_HOST_URL.replace(/\/+$/, '')}/`, token: process.env.EXPO_PUBLIC_HOST_TOKEN || 'dev' })
        : Promise.reject(new Error('Esta app necesita su módulo nativo (o EXPO_PUBLIC_HOST_URL en desarrollo).'))
    started
      .then(({ url, token }) => {
        // in development the page can come from Vite on the PC (see .env.development); the host stays where it is
        const dev = __DEV__ && process.env.EXPO_PUBLIC_VIEWER_URL
        const scheme = `&scheme=${Appearance.getColorScheme() || 'light'}`
        setPage(dev ? `${dev.replace(/\/+$/, '')}/?t=${token}&host=${encodeURIComponent(url.replace(/\/+$/, ''))}${scheme}` : `${url}?t=${token}${scheme}`)
      })
      .catch((err) => setError(String(err?.message || err)))
      .finally(() => SplashScreen.hideAsync().catch(() => {}))
  }, [])

  // the system's bar at the bottom stays hidden (a swipe from the edge brings it back for a moment): a reader wants the screen
  useEffect(() => {
    if (Platform.OS !== 'android') return
    try { Promise.resolve(NavigationBar.setVisibilityAsync('hidden')).catch(() => {}) } catch (_) {}
  }, [])
  useEffect(() => { try { Promise.resolve(SystemUI.setBackgroundColorAsync(scheme === 'dark' ? DARK : LIGHT)).catch(() => {}) } catch (_) {} }, [scheme])

  // the page follows the system's theme through here: its own media query follows the app's theme, not the system's
  useEffect(() => {
    web.current?.injectJavaScript(`window.__estanteriaScheme && window.__estanteriaScheme(${JSON.stringify(system || 'light')}); true;`)
  }, [system])

  // the back button goes back in the page (its views live in the hash); on the first view it leaves the app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) { web.current?.goBack(); return true }
      return false
    })
    return () => sub.remove()
  }, [])

  // a file opened with La Estantería from another app («Abrir con»)
  const open = useCallback((uri: string | null) => {
    if (!uri || !uri.startsWith('content://') && !uri.startsWith('file://')) return
    if (ready.current) web.current?.injectJavaScript(`window.__estanteriaOpen && window.__estanteriaOpen(${JSON.stringify(uri)}); true;`)
    else pending.current.push(uri)
  }, [])
  useEffect(() => {
    Linking.getInitialURL().then((u) => open(u ?? null))
    const sub = Linking.addEventListener('url', (e) => open(e.url))
    return () => sub.remove()
  }, [open])

  // a file of the service, fetched through the host into the app's own folder; the page shows how it goes on the
  // item's button (window.__estanteriaDownload) and, once there, asking again opens it with another app
  const tell = useCallback((text: string, error = false) => {
    web.current?.injectJavaScript(`window.__estanteriaNotify && window.__estanteriaNotify(${JSON.stringify(text)}, ${error}); true;`)
  }, [])
  const report = useCallback((path: string, state: { state: 'downloading' | 'done' | 'error'; percent?: number; error?: string; name?: string; bytes?: number } | null) => {
    web.current?.injectJavaScript(`window.__estanteriaDownload && window.__estanteriaDownload(${JSON.stringify(path)}, ${JSON.stringify(state)}); true;`)
  }, [])
  const openFile = useCallback(async (uri: string, name: string) => {
    try {
      const content = await FileSystem.getContentUriAsync(uri)
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: content, flags: 1, type: mimeOf(name) })
    } catch (err: any) {
      tell(`No hay con qué abrir ${name}: ${err?.message || err}`, true)
    }
  }, [tell])
  const queue = useRef<{ url: string; name: string; path: string; quiet: boolean }[]>([])
  const busy = useRef(false)
  /** «solo con wifi» on mobile data was already said in this run of the queue (once, not once per file) */
  const pausedTold = useRef(false)
  const download = useCallback(async (url: string, rawName: string, path: string, quiet: boolean) => {
    const name = fileNameOf(rawName)
    const target = `${DOWNLOADS}${name}`
    try {
      await FileSystem.makeDirectoryAsync(DOWNLOADS, { intermediates: true })
      const have = await FileSystem.getInfoAsync(target)
      if (have.exists && have.size > 0) { report(path, { state: 'done', name, bytes: have.size }); if (!quiet) await openFile(target, name); return }
      // «solo con wifi» (Ajustes, kept by the host): on mobile data the download does not start, and says why
      const blocked = typeof EstanteriaHost?.downloadBlocked === 'function' ? EstanteriaHost.downloadBlocked() : null
      if (blocked) {
        report(path, { state: 'error', error: blocked, name })
        if (!pausedTold.current) { pausedTold.current = true; tell(blocked, true) }
        return
      }
      let shown = -1
      report(path, { state: 'downloading', percent: 0, name })
      const job = FileSystem.createDownloadResumable(url, `${target}.part`, {}, (p) => {
        const pct = p.totalBytesExpectedToWrite > 0 ? Math.floor((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100) : -1
        if (pct !== shown) { shown = pct; report(path, { state: 'downloading', percent: Math.max(0, pct), name }) }
      })
      const result = await job.downloadAsync()
      if (!result || result.status >= 400) throw new Error(`HTTP ${result?.status ?? '?'}`)
      await FileSystem.moveAsync({ from: result.uri, to: target })
      await remember(path, name)
      const info = await FileSystem.getInfoAsync(target)
      report(path, { state: 'done', name, bytes: info.exists ? info.size : undefined })
      if (!quiet) tell(`Descargado: ${name}`)
    } catch (err: any) {
      report(path, { state: 'error', error: String(err?.message || err), name })
      tell(`No se pudo descargar ${name}: ${err?.message || err}`, true)
      FileSystem.deleteAsync(`${target}.part`, { idempotent: true }).catch(() => {})
    }
  }, [openFile, report, tell])
  // one at a time (a whole folder may be asked for at once)
  const enqueue = useCallback((job: { url: string; name: string; path: string; quiet: boolean }) => {
    queue.current.push(job)
    if (job.quiet) report(job.path, { state: 'downloading', percent: 0, name: fileNameOf(job.name) })
    if (busy.current) return
    busy.current = true
    pausedTold.current = false
    ;(async () => {
      while (queue.current.length) {
        const next = queue.current.shift()!
        await download(next.url, next.name, next.path, next.quiet)
      }
      busy.current = false
    })()
  }, [download, report])
  const removeDownload = useCallback(async (path: string) => {
    const index = await readIndex()
    const name = index[path]
    queue.current = queue.current.filter((j) => j.path !== path)
    if (name) {
      await FileSystem.deleteAsync(`${DOWNLOADS}${name}`, { idempotent: true }).catch(() => {})
      delete index[path]
      await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(index)).catch(() => {})
    }
    report(path, null)
  }, [report])

  // what is already downloaded, so the page shows it from the start
  const announceDownloads = useCallback(async () => {
    try {
      const index = await readIndex()
      for (const [path, name] of Object.entries(index)) {
        const have = await FileSystem.getInfoAsync(`${DOWNLOADS}${name}`)
        if (have.exists) report(path, { state: 'done', name, bytes: have.size })
      }
    } catch (_) { /* no downloads yet */ }
  }, [report])

  // the volume keys turn pages while a reader is open (the page turns them on and off: {type: 'volume-keys'})
  useEffect(() => {
    if (!EstanteriaHost || typeof EstanteriaHost.addListener !== 'function') return
    const sub = EstanteriaHost.addListener('onVolumeKey', ({ dir }) => {
      web.current?.injectJavaScript(`window.__estanteriaKey && window.__estanteriaKey(${dir < 0 ? -1 : 1}); true;`)
    })
    return () => sub.remove()
  }, [])

  // development: what the system leaves us (the gap under the bar is whatever the host app does not get)
  useEffect(() => {
    if (!__DEV__) return
    const w = Dimensions.get('window'), sc = Dimensions.get('screen')
    console.log(`[app] window ${w.width}x${w.height} screen ${sc.width}x${sc.height} scale ${sc.scale}`)
  }, [])

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any
    try { msg = JSON.parse(e.nativeEvent.data) } catch (_) { return }
    if (msg.type === 'ready') announceDownloads()
    if (msg.type === 'log') {
      ;(msg.level === 'error' ? console.error : msg.level === 'warn' ? console.warn : console.log)('[web]', ...(msg.args || []))
    } else if (msg.type === 'ready') {
      ready.current = true
      for (const uri of pending.current.splice(0)) open(uri)
    } else if (msg.type === 'theme') {
      setTheme(msg.value === 'light' || msg.value === 'dark' ? msg.value : 'system')
    } else if (msg.type === 'reading') {
      if (msg.on) activateKeepAwakeAsync().catch(() => {})
      else deactivateKeepAwake().catch(() => {})
    } else if (msg.type === 'open-url' && typeof msg.url === 'string') {
      Linking.openURL(msg.url).catch(() => {})
    } else if (msg.type === 'download' && typeof msg.url === 'string') {
      enqueue({ url: String(msg.url), name: String(msg.name || 'archivo'), path: String(msg.path || msg.url), quiet: !!msg.quiet })
    } else if (msg.type === 'remove-download' && typeof msg.path === 'string') {
      removeDownload(msg.path)
    } else if (msg.type === 'volume-keys') {
      if (typeof EstanteriaHost?.setVolumeKeys === 'function') EstanteriaHost.setVolumeKeys(!!msg.on)
    }
  }, [open, announceDownloads, enqueue, removeDownload])

  const background = scheme === 'dark' ? DARK : LIGHT
  return (
    <View style={[styles.root, { backgroundColor: background, paddingTop: RNStatusBar.currentHeight || 0 }]}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {error ? (
          <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
        ) : !page ? (
          <View style={styles.center}><ActivityIndicator color="#d9822b" /></View>
        ) : (
          <WebView
            ref={web}
            source={{ uri: page }}
            style={[styles.web, { backgroundColor: background }]}
            originWhitelist={['http://127.0.0.1:*', 'http://localhost:*', 'blob:*', 'about:*', 'data:*']}
            domStorageEnabled
            javaScriptEnabled
            allowsBackForwardNavigationGestures={false}
            setSupportMultipleWindows={false}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            overScrollMode="never"
            textZoom={100}
            forceDarkOn={false}
            onMessage={onMessage}
            injectedJavaScriptBeforeContentLoaded={DEV_CONSOLE}
            onError={(e: { nativeEvent: { description?: string; url?: string } }) => console.warn('[web] no carga', e.nativeEvent.description, e.nativeEvent.url)}
            onNavigationStateChange={(s: { canGoBack: boolean }) => { canGoBack.current = s.canGoBack }}
            onShouldStartLoadWithRequest={(req: { url: string }) => {
              if (req.url.startsWith('http://127.0.0.1') || req.url.startsWith('http://localhost')) return true
              // the book reader (foliate-js) lays each chapter out in a frame loaded from a blob: URL
              if (/^(blob|about|data):/.test(req.url)) return true
              Linking.openURL(req.url).catch(() => {})   // links out (a catalog's site, a server's web) go to the browser
              return false
            }}
          />
        )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#d9822b', textAlign: 'center', fontSize: 15 },
})

export const platform = Platform.OS
