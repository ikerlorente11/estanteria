/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// set at build time (an EAS environment variable, or web/.env.local): the app's credentials in Telegram's API
interface ImportMetaEnv {
  readonly VITE_TELEGRAM_API_ID?: string
  readonly VITE_TELEGRAM_API_HASH?: string
}
