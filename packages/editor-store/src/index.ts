// Core types

export {
  WebsocketAdapter,
  type WebsocketAdapterOptions,
} from './adapters/Websocket'
// Synced component
export { Synced } from './components/Synced'
// Component definitions
export {
  type AnyEditorComponentDef,
  defineEditorComponent,
  EditorComponentDef,
} from './EditorComponentDef'
// Singleton definitions
export {
  type AnyEditorSingletonDef,
  defineEditorSingleton,
  EditorSingletonDef,
  type SingletonEditorBehavior,
} from './EditorSingletonDef'
export {
  EditorStore,
  type EditorStoreInitOptions,
  type EditorStoreOptions,
} from './EditorStore'
export {
  type ComponentMigration,
  type MigrationResult,
  migrateComponentData,
  validateMigrations,
} from './migrations'
export type {
  InferEditorComponentType,
  SyncBehavior,
  VersionMismatchResponse,
} from './types'
