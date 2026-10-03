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
  // 动作允许从哪些当前状态发起：不填表示沿用旧逻辑（不做来源限制）。
  actionSources?: Record<string, string[]>
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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 一次管网检修单：登记检修即留底，追加写入，完成时只回填结果，不删历史。
export type MaintenanceOrder = {
  id: number
  orderNo: string
  segmentId: number
  segmentCode: string
  // 登记时巡检队上报的实测/登记值：设计压力在登记瞬间落库到管段，这里留档可追溯。
  designPressure: string
  measuredPressure: string
  inspector: string
  reason: string
  reportedAt: string
  completedAt: string
  result: string
  status: '检修中' | '已完成'
}

export type RegisterMaintenanceInput = {
  designPressure: string
  measuredPressure: string
  inspector: string
  reason: string
  reportedAt: string
}

export type CompleteMaintenanceInput = {
  result: string
}

// 阀门井待核查项：检修结果同步过来，阀门井侧逐条核查消项。
export type ValveCheckItem = {
  id: string
  wellId: string
  segmentCode: string
  orderNo: string
  result: string
  syncedAt: string
  checked: boolean
  checkedAt: string
  checker: string
  remark: string
}

export type SegmentDetail = {
  row: EntryRow
  orders: MaintenanceOrder[]
}
