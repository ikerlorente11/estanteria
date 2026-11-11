export type HostStarted = {
  /** where the page is, with a trailing slash: http://127.0.0.1:<port>/ */
  url: string
  /** what the page must send with every call to the host (`?t=` or X-Host-Token) */
  token: string
}

export type EstanteriaHostModuleEvents = {
  /** a volume key while they turn pages (setVolumeKeys(true)): +1 volume down (next page), -1 volume up (previous) */
  onVolumeKey: (event: { dir: 1 | -1 }) => void
}
