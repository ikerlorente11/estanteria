/** A file handed to the system: saved where the person wants, or shared. */
export interface FileToHand {
  name: string
  mime: string
  /** where the app serves it: the URL the page reads it at (a file of this device, a kept copy) or the
   * service's API path (`/api/items/<id>/file`) */
  src: string
  /** its bytes, read by the page (for a host that takes them so) */
  blob(): Promise<Blob>
}

/** What only the app's native side can do, when it can (each is optional; the settings show what is there). */
export interface NativeFeatures {
  /** Android: while reading, the volume keys turn pages (they reach the page as a `es-turn` event) */
  volumeKeys?(on: boolean): void
  /** Android: downloads only on Wi-Fi; on mobile data they are refused with a clear message */
  wifiOnly?(on: boolean): void
  /** the system's «save as»: the file copied where the person chooses; false if they gave up */
  saveAs?(file: FileToHand): Promise<boolean>
  /** the system's share sheet with the file (mail, chats, other apps) */
  share?(file: FileToHand): Promise<void>
  /** the device's own lock: fingerprint, face or its PIN (Android: BiometricPrompt; Windows: Windows Hello) */
  lock?: {
    /** whether this device can (it has a lock set up) */
    available(): Promise<boolean>
    /** asks for it; true when the person passed */
    unlock(reason: string): Promise<boolean>
  }
}

/** A page turn asked from outside the reader (the volume keys): +1 the next page, -1 the previous one. */
export const TURN_EVENT = 'es-turn'
export function turnPage(dir: 1 | -1): void {
  window.dispatchEvent(new CustomEvent(TURN_EVENT, { detail: dir }))
}
