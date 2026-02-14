// Core types

export {
  WebsocketAdapter,
  type WebsocketAdapterOptions,
} from './adapters/Websocket'
// Component definitions
export {
  type AnyCanvasComponentDef,
  CanvasComponentDef,
  defineCanvasComponent,
} from './CanvasComponentDef'
// Singleton definitions
export {
  type AnyCanvasSingletonDef,
  CanvasSingletonDef,
  defineCanvasSingleton,
  type SingletonSyncBehavior,
} from './CanvasSingletonDef'
export {
  CanvasStore,
  type CanvasStoreInitOptions,
  type CanvasStoreOptions,
  type HistoryOptions,
  type PersistenceOptions,
  type WebsocketOptions,
} from './CanvasStore'
// Synced component
export { Synced } from './components/Synced'
export {
  type ComponentMigration,
  type MigrationResult,
  migrateComponentData,
  validateMigrations,
} from './migrations'
export type {
  InferCanvasComponentType,
  SyncBehavior,
  VersionMismatchResponse,
} from './types'
