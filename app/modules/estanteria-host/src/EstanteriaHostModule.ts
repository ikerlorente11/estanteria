import { NativeModule, requireNativeModule } from 'expo'

import type { EstanteriaHostModuleEvents, HostStarted } from './EstanteriaHost.types'

declare class EstanteriaHostModule extends NativeModule<EstanteriaHostModuleEvents> {
  /** starts the local server the web view loads the viewer from (or finds it running) */
  start(): Promise<HostStarted>
  stop(): void
}

export default requireNativeModule<EstanteriaHostModule>('EstanteriaHost')
