declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** a file's URL, given by the host's bundler (Vite) */
declare module '*?url' {
  const src: string
  export default src
}
