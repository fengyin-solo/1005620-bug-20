import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  commitState,
  listMaintenanceOrders,
  listRows,
  listValveChecks as readValveChecks,
  resetRows,
  saveRows,
  saveValveChecks,
} from '@/data/local-store'
import type {
  ActionResult,
  CompleteMaintenanceInput,
  EntryRow,
  MaintenanceOrder,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RegisterMaintenanceInput,
  SegmentDetail,
  ValveCheckItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const PRIMARYNET_KEY = 'primarynet'
const VALVEWELL_KEY = 'valvewell'
const DESIGN_PRESSURE_FIELD = '设计压力'
const SEGMENT_CODE_FIELD = '管段编号'
const WELL_CODE_FIELD = '井编号'
const WELL_SEGMENT_FIELD = '所属管段'

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
  // 状态机：登记了来源的动作只能从白名单状态发起，越级一律挡回，终态（已废弃等）不再放行任何动作。
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    const terminal = meta.statuses[meta.statuses.length - 1]
    if (current === terminal) {
      return { ok: false, message: `${meta.entity}已${current}，不能再执行「${action}」` }
    }
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，不允许${action}（仅「${sources.join('、')}」状态可发起），越级操作已挡回`,
    }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
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

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// ---------------------------------------------------------------------------
// 一次管网：管段详情与导出清单共用的取数口径
// ---------------------------------------------------------------------------

// 同一份投影：管段详情弹窗读什么、导出表就导什么，字段缺失统一落空串，不再各取各的。
function projectSegment(row: EntryRow): EntryRow {
  const meta = moduleMeta(PRIMARYNET_KEY)
  const projected: EntryRow = {
    id: row.id,
    status: String(row.status ?? ''),
    pending: Boolean(row.pending),
    abnormal: Boolean(row.abnormal),
  }
  for (const field of meta.fields) {
    projected[field] = row[field] ?? ''
  }
  return projected
}

// 导出/详情共用的管段清单口径。
export function getSegmentRows(): EntryRow[] {
  return listRows(PRIMARYNET_KEY).map(projectSegment)
}

// 管段详情：投影后的管段 + 该管段全部检修单（含已完成留底，实测值可追溯）。
export function getSegmentDetail(id: number): SegmentDetail {
  const row = listRows(PRIMARYNET_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    throw new Error(`没有找到编号为 ${id} 的一次管网管段`)
  }
  const orders = listMaintenanceOrders()
    .filter((order) => order.segmentId === id)
    .sort((a, b) => b.id - a.id)
  return { row: projectSegment(row), orders }
}

export function listMaintenanceOrdersForSegment(id: number): MaintenanceOrder[] {
  return listMaintenanceOrders()
    .filter((order) => order.segmentId === id)
    .sort((a, b) => b.id - a.id)
}

function nowText(): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${date} ${time}`
}

export function todayText(): string {
  return nowText().slice(0, 10)
}

function parsePressure(value: string): number {
  const text = value.trim()
  if (text === '') {
    return Number.NaN
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : Number.NaN
}

function makeOrderNo(sequence: number): string {
  const d = new Date()
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  return `MNT-${ym}-${String(sequence).padStart(3, '0')}`
}

/**
 * 登记检修（一次落库）：
 * - 设计压力、检修状态连同检修单在同一次提交里写进本地库，不再只停在页面；
 * - 设计压力无效值先退回，不允许落库；
 * - 已报废管段、非运行中（越级）一律挡回；
 * - 同一管段存在进行中检修单时，重复提交只记一遍；
 * - 巡检队实测值、上报人随检修单留底，长期可追溯。
 */
export function registerMaintenance(id: number, input: RegisterMaintenanceInput): ActionResult {
  const designPressure = input.designPressure.trim()
  const designNum = parsePressure(designPressure)
  if (!Number.isFinite(designNum) || designNum <= 0) {
    return { ok: false, message: '设计压力为无效值（需为大于 0 的数字，单位 MPa），已退回，请核对后重新提交' }
  }
  const measuredPressure = input.measuredPressure.trim()
  const measuredNum = parsePressure(measuredPressure)
  if (!Number.isFinite(measuredNum) || measuredNum < 0) {
    return { ok: false, message: '巡检队上报的实测压力为无效值（需为不小于 0 的数字，单位 MPa），已退回' }
  }
  const inspector = input.inspector.trim()
  if (!inspector) {
    return { ok: false, message: '上报巡检队（人）必填，实测值需要可追溯' }
  }
  const reason = input.reason.trim()
  if (!reason) {
    return { ok: false, message: '检修原因必填' }
  }
  const reportedAt = input.reportedAt.trim()
  if (!reportedAt) {
    return { ok: false, message: '上报日期必填' }
  }

  const rows = listRows(PRIMARYNET_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的一次管网管段` }
  }
  const current = String(rows[index].status)
  if (current === '已废弃') {
    return { ok: false, message: '该管段已报废，不能再提交检修' }
  }
  const orders = listMaintenanceOrders()
  // 幂等优先：同一管段已有进行中检修单时，重复提交只记一遍（先于越级校验给出明确提示）。
  const duplicated = orders.find((order) => order.segmentId === id && order.status === '检修中')
  if (duplicated) {
    return {
      ok: false,
      message: `检修单 ${duplicated.orderNo} 尚未完成，同一管段重复提交检修上报只记一遍`,
    }
  }
  if (current !== '运行中') {
    return {
      ok: false,
      message: `管段当前为「${current}」，登记检修需处于「运行中」，越级操作已挡回`,
    }
  }
  const sequence = orders.reduce((max, order) => Math.max(max, order.id), 0) + 1
  const order: MaintenanceOrder = {
    id: sequence,
    orderNo: makeOrderNo(sequence),
    segmentId: id,
    segmentCode: String(rows[index][SEGMENT_CODE_FIELD] ?? ''),
    designPressure,
    measuredPressure,
    inspector,
    reason,
    reportedAt,
    completedAt: '',
    result: '',
    status: '检修中',
  }
  const updated: EntryRow = {
    ...rows[index],
    [DESIGN_PRESSURE_FIELD]: designPressure,
    status: '检修中',
    pending: true,
    abnormal: false,
  }
  // 管段字段、状态与检修单在同一份状态里改完一次落库，不存在只写一半的情况。
  commitState((draft) => {
    draft.entries[PRIMARYNET_KEY][index] = updated
    draft.maintenanceOrders.push(order)
  })
  return { ok: true, message: `检修单 ${order.orderNo} 已登记落库，设计压力同步更新，管段进入「检修中」` }
}

/**
 * 完成检修：回填检修结果、管段恢复运行，并把结果同步到阀门井待核查清单。
 * 只允许从「检修中」完成；按检修单天然幂等，重复完成挡在状态校验外。
 */
export function completeMaintenance(id: number, input: CompleteMaintenanceInput): ActionResult {
  const result = input.result.trim()
  if (!result) {
    return { ok: false, message: '检修结果必填，阀门井待核查清单需要同步该结果' }
  }
  const rows = listRows(PRIMARYNET_KEY)
  const segmentIndex = rows.findIndex((row) => Number(row.id) === id)
  if (segmentIndex < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的一次管网管段` }
  }
  const current = String(rows[segmentIndex].status)
  if (current !== '检修中') {
    return {
      ok: false,
      message: `管段当前为「${current}」，只有「检修中」的管段能完成检修，越级操作已挡回`,
    }
  }
  const orders = listMaintenanceOrders()
  const orderIndex = orders.findIndex((order) => order.segmentId === id && order.status === '检修中')
  if (orderIndex < 0) {
    return { ok: false, message: '该管段没有进行中的检修单，无法完成' }
  }
  const order = orders[orderIndex]
  const completedAt = nowText()

  // 找到挂在该管段上的阀门井；台账里暂时没挂井时，落一条待关联项，保证同步不丢。
  const wells = listRows(VALVEWELL_KEY).filter(
    (well) => String(well[WELL_SEGMENT_FIELD] ?? '').trim() === order.segmentCode,
  )
  const synced: ValveCheckItem[] = wells.length
    ? wells.map((well) => ({
        id: `${String(well[WELL_CODE_FIELD] ?? '')}:${order.id}`,
        wellId: String(well[WELL_CODE_FIELD] ?? ''),
        segmentCode: order.segmentCode,
        orderNo: order.orderNo,
        result,
        syncedAt: completedAt,
        checked: false,
        checkedAt: '',
        checker: '',
        remark: '',
      }))
    : [
        {
          id: `PENDING:${order.segmentCode}:${order.id}`,
          wellId: '',
          segmentCode: order.segmentCode,
          orderNo: order.orderNo,
          result,
          syncedAt: completedAt,
          checked: false,
          checkedAt: '',
          checker: '',
          remark: '',
        },
      ]

  commitState((draft) => {
    draft.entries[PRIMARYNET_KEY][segmentIndex] = {
      ...rows[segmentIndex],
      status: '运行中',
      pending: true,
      abnormal: false,
    }
    const targetOrder = draft.maintenanceOrders[orderIndex]
    targetOrder.status = '已完成'
    targetOrder.completedAt = completedAt
    targetOrder.result = result
    // 同一检修单对同一口井只同步一条，重复完成也不会记两遍。
    const known = new Set(draft.valveChecks.map((item) => item.id))
    for (const item of synced) {
      if (!known.has(item.id)) {
        draft.valveChecks.push(item)
      }
    }
  })
  return {
    ok: true,
    message: `检修单 ${order.orderNo} 已完成并留底，结果已同步到阀门井待核查清单（${synced.length} 项）`,
  }
}

// ---------------------------------------------------------------------------
// 阀门井：待核查清单（检修结果同步来源）
// ---------------------------------------------------------------------------

export function listValveChecks(onlyPending = false): ValveCheckItem[] {
  return readValveChecks()
    .filter((item) => !onlyPending || !item.checked)
    .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
}

export function checkValveItem(
  id: string,
  input: { checker: string; remark: string },
): ActionResult {
  const checker = input.checker.trim()
  if (!checker) {
    return { ok: false, message: '核查人必填' }
  }
  const items = readValveChecks()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '待核查项不存在或已被移除' }
  }
  if (items[index].checked) {
    return { ok: false, message: '该待核查项已核查，不用重复提交' }
  }
  const next = [...items]
  next[index] = {
    ...items[index],
    checked: true,
    checkedAt: nowText(),
    checker,
    remark: input.remark.trim(),
  }
  saveValveChecks(next)
  return { ok: true, message: '核查结果已登记，该项已从待核查清单移除' }
}

// ---------------------------------------------------------------------------

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  // 一次管网走与管段详情相同的取数口径，导出的每一列都跟详情读到的对得上。
  const source = key === PRIMARYNET_KEY ? getSegmentRows() : listRows(key)
  for (const row of source) {
    lines.push(
      [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].map(csvCell).join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
