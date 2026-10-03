/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 动作允许的起始状态：登记了就按表挡回越级与终态操作，没登记的动作保持原放行逻辑。 */
  actionFrom?: Record<string, string[]>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 巡检队上报的一次管网检修登记内容。 */
export type MaintenancePayload = {
  designPressure: string
  measuredPressure: string
  maintenanceState: string
  reporter: string
  operator: string
}

/** 检修单留底：登记检修一次落一条，巡检队上报的实测值可追溯到上报人。 */
export type MaintenanceOrder = {
  orderNo: string
  moduleKey: string
  entryId: number
  segmentCode: string
  designPressure: string
  measuredPressure: string
  maintenanceState: string
  reporter: string
  operator: string
  submittedAt: string
  /** 幂等键：同一份上报重复提交时命中它，只记一遍。 */
  fingerprint: string
}

export type MaintenanceResult = ActionResult & {
  orderNo?: string
  duplicated?: boolean
  syncedWells?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
