import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Appearance, BackHandler, Linking, Platform, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
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
    azw3: 'application/vnd.amazon.mobi8-ebook', fb2: 'application/x-fictionbook+xml' }[ext] || 'application/octet-stream'
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
    NavigationBar.setVisibilityAsync('hidden').catch(() => {})
  }, [])
  useEffect(() => { SystemUI.setBackgroundColorAsync(scheme === 'dark' ? DARK : LIGHT).catch(() => {}) }, [scheme])

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
  const report = useCallback((path: string, state: { state: 'downloading' | 'done' | 'error'; percent?: number; error?: string } | null) => {
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
  const download = useCallback(async (url: string, rawName: string, path: string) => {
    const name = fileNameOf(rawName)
    const target = `${DOWNLOADS}${name}`
    try {
      await FileSystem.makeDirectoryAsync(DOWNLOADS, { intermediates: true })
      const have = await FileSystem.getInfoAsync(target)
      if (have.exists && have.size > 0) { report(path, { state: 'done' }); await openFile(target, name); return }
      let shown = -1
      report(path, { state: 'downloading', percent: 0 })
      const job = FileSystem.createDownloadResumable(url, `${target}.part`, {}, (p) => {
        const pct = p.totalBytesExpectedToWrite > 0 ? Math.floor((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100) : -1
        if (pct !== shown) { shown = pct; report(path, { state: 'downloading', percent: Math.max(0, pct) }) }
      })
      const result = await job.downloadAsync()
      if (!result || result.status >= 400) throw new Error(`HTTP ${result?.status ?? '?'}`)
      await FileSystem.moveAsync({ from: result.uri, to: target })
      await remember(path, name)
      report(path, { state: 'done' })
      tell(`Descargado: ${name}`)
    } catch (err: any) {
      report(path, { state: 'error', error: String(err?.message || err) })
      tell(`No se pudo descargar ${name}: ${err?.message || err}`, true)
      FileSystem.deleteAsync(`${target}.part`, { idempotent: true }).catch(() => {})
    }
  }, [openFile, report, tell])

  // what is already downloaded, so the page shows it from the start
  const announceDownloads = useCallback(async () => {
    try {
      const index = await readIndex()
      for (const [path, name] of Object.entries(index)) {
        const have = await FileSystem.getInfoAsync(`${DOWNLOADS}${name}`)
        if (have.exists) report(path, { state: 'done' })
      }
    } catch (_) { /* no downloads yet */ }
  }, [report])

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
      download(String(msg.url), String(msg.name || 'archivo'), String(msg.path || msg.url))
    }
  }, [open])

  const background = scheme === 'dark' ? DARK : LIGHT
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: background }]} edges={['top', 'left', 'right']}>
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
            originWhitelist={['http://127.0.0.1:*', 'http://localhost:*']}
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
              Linking.openURL(req.url).catch(() => {})   // links out (a catalog's site, the Archivador) go to the browser
              return false
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#d9822b', textAlign: 'center', fontSize: 15 },
})

export const platform = Platform.OS
