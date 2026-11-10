export type HostStarted = {
  /** where the page is, with a trailing slash: http://127.0.0.1:<port>/ */
  url: string
  /** what the page must send with every call to the host (`?t=` or X-Host-Token) */
  token: string
}

export type EstanteriaHostModuleEvents = {}
