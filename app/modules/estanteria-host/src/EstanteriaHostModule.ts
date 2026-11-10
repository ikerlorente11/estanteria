import { NativeModule, requireOptionalNativeModule } from 'expo'

import type { EstanteriaHostModuleEvents, HostStarted } from './EstanteriaHost.types'

declare class EstanteriaHostModule extends NativeModule<EstanteriaHostModuleEvents> {
  /** starts the local server the web view loads the viewer from (or finds it running) */
  start(): Promise<HostStarted>
  stop(): void
}

/** null in Expo Go (no native code there): the app then uses the development host on the PC, see devhost/. */
export default requireOptionalNativeModule<EstanteriaHostModule>('EstanteriaHost')
