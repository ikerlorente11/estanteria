import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Appearance, BackHandler, Linking, Platform, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as SplashScreen from 'expo-splash-screen'

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

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any
    try { msg = JSON.parse(e.nativeEvent.data) } catch (_) { return }
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
    }
  }, [open])

  const background = scheme === 'dark' ? DARK : LIGHT
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: background }]} edges={['top', 'bottom', 'left', 'right']}>
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
