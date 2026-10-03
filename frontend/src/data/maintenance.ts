import type { MaintenanceOrder } from './types'

// 检修单留底：独立于台账行的存储，重置台账不会丢检修单，实测值始终能追溯到上报人。
const ORDER_STORAGE_KEY = 'district-heating:maintenance-orders'

function readOrders(): MaintenanceOrder[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(ORDER_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as MaintenanceOrder[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let cache: MaintenanceOrder[] | null = null

export function listMaintenanceOrders(moduleKey?: string, entryId?: number): MaintenanceOrder[] {
  if (cache === null) {
    cache = readOrders()
  }
  return cache.filter(
    (order) =>
      (moduleKey === undefined || order.moduleKey === moduleKey) &&
      (entryId === undefined || Number(order.entryId) === entryId),
  )
}

export function findMaintenanceOrder(fingerprint: string): MaintenanceOrder | undefined {
  return listMaintenanceOrders().find((order) => order.fingerprint === fingerprint)
}

export function appendMaintenanceOrder(order: MaintenanceOrder): void {
  const next = [...listMaintenanceOrders(), order]
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next))
  }
}

export function nextOrderNo(now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const todayCount = listMaintenanceOrders().filter((order) =>
    order.orderNo.startsWith(`MNT-${stamp}-`),
  ).length
  return `MNT-${stamp}-${String(todayCount + 1).padStart(3, '0')}`
}
