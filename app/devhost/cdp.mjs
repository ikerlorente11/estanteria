// Evaluates a JS expression inside the app's WebView (a debug build exposes Chrome DevTools) and prints the result:
//   adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.ikerlorente11.estanteria)
//   node devhost/cdp.mjs "(async () => { ... return something })()"
// Needs Node 22 (global fetch and WebSocket).
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((p) => p.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
const expr = process.argv[2]
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
const msg = await new Promise((r) => ws.addEventListener('message', (e) => r(JSON.parse(e.data))))
console.log(JSON.stringify(msg.result?.result?.value ?? msg.result?.exceptionDetails?.exception?.description ?? msg, null, 1).slice(0, 3000))
ws.close()
