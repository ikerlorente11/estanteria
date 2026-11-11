import { NativeModule, requireOptionalNativeModule } from 'expo'

import type { EstanteriaHostModuleEvents, HostStarted } from './EstanteriaHost.types'

declare class EstanteriaHostModule extends NativeModule<EstanteriaHostModuleEvents> {
  /** starts the local server the web view loads the viewer from (or finds it running) */
  start(): Promise<HostStarted>
  stop(): void
  /** serves the viewer the JS bundle brings (a zip: an update brings a new one) instead of the APK's; its folder or null */
  useViewer?(uri: string, hash: string): Promise<string | null>
  /** while on, the volume keys turn pages (the `onVolumeKey` event) instead of changing the volume */
  setVolumeKeys(on: boolean): void
  /** why a download of the app's own may not start now («solo con wifi» on mobile data), or null */
  downloadBlocked(): string | null
}

/** null in Expo Go (no native code there): the app then uses the development host on the PC, see devhost/. */
export default requireOptionalNativeModule<EstanteriaHostModule>('EstanteriaHost')
