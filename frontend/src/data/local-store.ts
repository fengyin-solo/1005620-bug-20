import { SEED_ROWS, SEED_STATE } from './seed'
import type { EntryRow, MaintenanceOrder, ValveCheckItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'district-heating:entries'
// 数据结构版本：集合结构变更后 bump，旧缓存按新版本播种，避免半新半旧的脏数据。
const STORAGE_VERSION = 2

export type StorageState = {
  entries: Record<string, EntryRow[]>
  maintenanceOrders: MaintenanceOrder[]
  valveChecks: ValveCheckItem[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): StorageState {
  return clone(SEED_STATE)
}

function readStorage(): StorageState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: fallback }))
    return fallback
  }
  try {
    const envelope = JSON.parse(raw) as { version?: number; state?: StorageState }
    // 结构对不上（旧版平铺数据或缺集合）时，整库按当前版本重新播种。
    if (
      envelope.version !== STORAGE_VERSION ||
      !envelope.state ||
      !envelope.state.entries ||
      !Array.isArray(envelope.state.maintenanceOrders) ||
      !Array.isArray(envelope.state.valveChecks)
    ) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: fallback }))
      return fallback
    }
    // 新版本新增的模块在旧缓存里会缺，用种子补齐。
    envelope.state.entries = { ...clone(SEED_ROWS), ...envelope.state.entries }
    return envelope.state
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: fallback }))
    return fallback
  }
}

let cache: StorageState | null = null

function state(): StorageState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, state: state() }),
    )
  }
}

export function allRows(): Record<string, EntryRow[]> {
  return state().entries
}

export function listRows(key: string): EntryRow[] {
  return state().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  state().entries = { ...state().entries, [key]: rows }
  persist()
}

export function listMaintenanceOrders(): MaintenanceOrder[] {
  return state().maintenanceOrders
}

export function saveMaintenanceOrders(orders: MaintenanceOrder[]): void {
  state().maintenanceOrders = orders
  persist()
}

export function listValveChecks(): ValveCheckItem[] {
  return state().valveChecks
}

export function saveValveChecks(items: ValveCheckItem[]): void {
  state().valveChecks = items
  persist()
}

/**
 * 一次落库：一次业务动作涉及多份数据（管段、检修单、阀门井待核查）时，
 * 在同一份状态上改完再统一持久化，避免只写进去一半。
 */
export function commitState(mutate: (draft: StorageState) => void): StorageState {
  const draft = clone(state())
  mutate(draft)
  cache = draft
  persist()
  return draft
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
