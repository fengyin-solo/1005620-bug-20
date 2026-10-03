import { MODULE_BY_KEY } from '@/data/modules'
import {
  appendMaintenanceOrder,
  findMaintenanceOrder,
  listMaintenanceOrders,
  nextOrderNo,
} from '@/data/maintenance'
import { allRows, listRows, resetRows, saveAllRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  MaintenanceOrder,
  MaintenancePayload,
  MaintenanceResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 越级与终态挡回：模块在 actionFrom 里登记了允许起始状态，就按表校验；没登记的动作不拦。
function transitionBlock(meta: ModuleMeta, action: string, current: string): string | null {
  const from = meta.actionFrom?.[action]
  if (from && !from.includes(current)) {
    return `${meta.entity}当前状态「${current}」不允许执行「${action}」，已挡回`
  }
  return null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const blocked = transitionBlock(meta, action, current)
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 管段详情与导出清单共用同一份取数口径：都读 listRows 这份落库数据，不另开缓存。
export function getEntryDetail(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

// 一次管网设计压力的有效区间（MPa）：无效值先退回，不进库、不联动。
const MAX_DESIGN_PRESSURE_MPA = 4.0

function isValidDesignPressure(value: string): boolean {
  const num = Number(value)
  return value !== '' && Number.isFinite(num) && num > 0 && num <= MAX_DESIGN_PRESSURE_MPA
}

function isValidMeasuredPressure(value: string): boolean {
  const num = Number(value)
  return value !== '' && Number.isFinite(num) && num >= 0
}

// 登记检修：校验 → 挡回 → 幂等 → 管段行、阀门井待核查、检修单留底一次落库。
export function registerMaintenance(
  key: string,
  id: number,
  payload: MaintenancePayload,
): MaintenanceResult {
  const meta = moduleMeta(key)
  const action = '登记检修'
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const blocked = transitionBlock(meta, action, current)
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const designPressure = payload.designPressure.trim()
  if (!isValidDesignPressure(designPressure)) {
    return {
      ok: false,
      message: `设计压力「${payload.designPressure}」无效，已退回：需为 0~${MAX_DESIGN_PRESSURE_MPA} MPa 之间的数值`,
    }
  }
  const measuredPressure = payload.measuredPressure.trim()
  if (!isValidMeasuredPressure(measuredPressure)) {
    return { ok: false, message: `实测压力「${payload.measuredPressure}」无效，已退回：需为不小于 0 的数值` }
  }
  const reporter = payload.reporter.trim()
  if (!reporter) {
    return { ok: false, message: '巡检队上报人不能为空，实测值需要可追溯' }
  }
  const maintenanceState = payload.maintenanceState.trim()
  if (!maintenanceState) {
    return { ok: false, message: '检修状态不能为空' }
  }
  // 幂等：同一份上报重复提交只记一遍，直接回已有检修单号。
  const fingerprint = [key, id, designPressure, measuredPressure, maintenanceState, reporter].join('|')
  const existing = findMaintenanceOrder(fingerprint)
  if (existing) {
    return {
      ok: true,
      message: `该检修上报已登记过（检修单 ${existing.orderNo}），重复提交只记一遍`,
      orderNo: existing.orderNo,
      duplicated: true,
    }
  }
  const segment = rows[index]
  const order: MaintenanceOrder = {
    orderNo: nextOrderNo(new Date()),
    moduleKey: key,
    entryId: id,
    segmentCode: String(segment['管段编号'] ?? id),
    designPressure,
    measuredPressure,
    maintenanceState,
    reporter,
    operator: payload.operator,
    submittedAt: new Date().toISOString(),
    fingerprint,
  }
  const updated: EntryRow = {
    ...segment,
    设计压力: designPressure,
    管段状态: maintenanceState,
    status: target,
    pending: true,
    abnormal: false,
  }
  const nextSegments = [...rows]
  nextSegments[index] = updated
  // 检修结果同步到阀门井待核查清单：该管段下的井全部回到待检查。
  let syncedWells = 0
  const nextWells = listRows('valvewell').map((well) => {
    if (String(well['所属管段']) !== order.segmentCode || String(well.status) === '待检查') {
      return well
    }
    syncedWells += 1
    return { ...well, status: '待检查', pending: true }
  })
  saveAllRows({ ...allRows(), [key]: nextSegments, valvewell: nextWells })
  appendMaintenanceOrder(order)
  return {
    ok: true,
    message: `检修单 ${order.orderNo} 已登记落库，同步阀门井待核查 ${syncedWells} 口`,
    orderNo: order.orderNo,
    syncedWells,
  }
}

export function listEntryMaintenanceOrders(key: string, id: number): MaintenanceOrder[] {
  return listMaintenanceOrders(key, id)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 导出与列表、管段详情读的是同一份 listRows 落库数据，字段口径以 meta.fields 为准。
export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
