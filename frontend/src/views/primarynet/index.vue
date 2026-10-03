<template>
  <section class="page" data-module="primarynet">
    <header class="page-head">
      <div>
        <h2>一次管网管理</h2>
        <p class="page-desc">维护一次管网管段，围绕管段编号、起点、终点、公称管径做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记一次管网管段</button>
        <button class="btn" type="button" @click="exportRows">导出一次管网清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无一次管网数据，可先登记一次管网管段</td>
        </tr>
      </tbody>
    </table>

    <section v-if="detail" class="detail-panel">
      <header class="detail-head">
        <h3>管段详情 · {{ detail['管段编号'] ?? detail.id }}</h3>
        <button class="btn ghost" type="button" @click="closeDetail">收起</button>
      </header>
      <div class="detail-grid">
        <div v-for="column in columns" :key="column" class="detail-cell">
          <span>{{ column }}</span>
          <strong>{{ detail[column] ?? '—' }}</strong>
        </div>
        <div class="detail-cell">
          <span>当前状态</span>
          <strong>{{ detail.status }}</strong>
        </div>
      </div>
      <h4 class="detail-sub">检修单留底（{{ detailOrders.length }}）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>检修单号</th>
            <th>设计压力(MPa)</th>
            <th>实测压力(MPa)</th>
            <th>检修状态</th>
            <th>上报人</th>
            <th>登记人</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in detailOrders" :key="order.orderNo">
            <td>{{ order.orderNo }}</td>
            <td>{{ order.designPressure }}</td>
            <td>{{ order.measuredPressure }}</td>
            <td>{{ order.maintenanceState }}</td>
            <td>{{ order.reporter }}</td>
            <td>{{ order.operator }}</td>
            <td>{{ formatTime(order.submittedAt) }}</td>
          </tr>
          <tr v-if="!detailOrders.length">
            <td colspan="7" class="empty-state">暂无检修单留底</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="maintenanceTarget" class="dialog-mask" @click.self="closeMaintenance">
      <form class="dialog-card" @submit.prevent="submitMaintenance">
        <h3>登记检修 · {{ maintenanceTarget['管段编号'] ?? maintenanceTarget.id }}</h3>
        <label class="dialog-field">
          <span>设计压力（MPa，0~4.0）</span>
          <input v-model="maintenanceForm.designPressure" placeholder="如 1.6" />
        </label>
        <label class="dialog-field">
          <span>实测压力（MPa，巡检队上报）</span>
          <input v-model="maintenanceForm.measuredPressure" placeholder="如 1.2" />
        </label>
        <label class="dialog-field">
          <span>检修状态</span>
          <select v-model="maintenanceForm.maintenanceState">
            <option v-for="state in maintenanceStates" :key="state" :value="state">{{ state }}</option>
          </select>
        </label>
        <label class="dialog-field">
          <span>上报人（巡检队）</span>
          <input v-model="maintenanceForm.reporter" placeholder="巡检队上报人姓名" />
        </label>
        <p v-if="maintenanceError" class="error-text dialog-error">{{ maintenanceError }}</p>
        <div class="dialog-actions">
          <button class="btn ghost" type="button" @click="closeMaintenance">取消</button>
          <button class="btn primary" type="submit">提交检修登记</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条一次管网记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntryDetail,
  listEntries,
  listEntryMaintenanceOrders,
  moduleMeta,
  registerMaintenance,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, MaintenanceOrder } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('primarynet')
const columns = ["管段编号", "起点", "终点", "公称管径", "设计压力", "敷设方式", "保温形式", "管段状态"]
const actions = ["提交投运", "登记检修", "报废管段"]
const statuses = ["待投运", "运行中", "检修中", "已废弃"]
const maintenanceStates = ["待处理", "处理中", "已完工"]

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detail = ref<EntryRow | null>(null)
const detailOrders = ref<MaintenanceOrder[]>([])
const maintenanceTarget = ref<EntryRow | null>(null)
const maintenanceError = ref('')
const maintenanceForm = ref({
  designPressure: '',
  measuredPressure: '',
  maintenanceState: maintenanceStates[0],
  reporter: '',
})

// 统计与列表同一份行数据，不另算一套。
const stats = computed(() =>
  meta.metrics.map((label) => ({
    label,
    value: rows.value.filter((row) => String(row.status) === label.replace(/管段$/, '')).length,
  })),
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatTime(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '一次管网管段登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  detail.value = getEntryDetail(meta.key, Number(row.id))
  detailOrders.value = listEntryMaintenanceOrders(meta.key, Number(row.id))
}

function closeDetail() {
  detail.value = null
  detailOrders.value = []
}

function refreshDetail() {
  if (detail.value) {
    openDetail(detail.value)
  }
}

function openMaintenance(row: EntryRow) {
  maintenanceError.value = ''
  maintenanceTarget.value = row
  maintenanceForm.value = {
    designPressure: String(row['设计压力'] ?? ''),
    measuredPressure: '',
    maintenanceState: maintenanceStates[0],
    reporter: '',
  }
}

function closeMaintenance() {
  maintenanceTarget.value = null
  maintenanceError.value = ''
}

function submitMaintenance() {
  if (!maintenanceTarget.value) {
    return
  }
  maintenanceError.value = ''
  const result = registerMaintenance(meta.key, Number(maintenanceTarget.value.id), {
    designPressure: maintenanceForm.value.designPressure,
    measuredPressure: maintenanceForm.value.measuredPressure,
    maintenanceState: maintenanceForm.value.maintenanceState,
    reporter: maintenanceForm.value.reporter,
    operator: session.operator,
  })
  if (!result.ok) {
    maintenanceError.value = result.message
    return
  }
  noticeMessage.value = result.message
  closeMaintenance()
  reload()
  refreshDetail()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '登记检修') {
    openMaintenance(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
  refreshDetail()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '一次管网列表读取失败'
  }
}

onMounted(reload)
</script>
