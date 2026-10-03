<template>
  <section class="page" data-module="primarynet">
    <header class="page-head">
      <div>
        <h2>一次管网管理</h2>
        <p class="page-desc">维护一次管网管段，围绕管段编号、起点、终点、公称管径做登记、筛选与状态流转。登记检修一次落库，管段详情与导出清单共用一份取数口径。</p>
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
            <button class="link" type="button" @click="openDetail(row)">管段详情</button>
            <button
              v-for="action in rowActions(row)"
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

    <footer class="page-foot">
      <span>共 {{ total }} 条一次管网记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 登记检修：设计压力等字段在这里一次提交落库 -->
    <div v-if="registerTarget" class="modal-mask" @click.self="closeRegister">
      <div class="modal">
        <h3 class="modal-title">登记检修 · {{ registerTarget['管段编号'] }}</h3>
        <p class="modal-hint">登记后设计压力与检修状态直接落库，并生成检修单留底；已报废、越级提交会被挡回。</p>
        <form class="modal-form" @submit.prevent="submitRegister">
          <label class="form-item">
            <span>设计压力（MPa）</span>
            <input v-model="registerForm.designPressure" placeholder="如 1.6，须为大于 0 的数字" />
          </label>
          <label class="form-item">
            <span>巡检队实测压力（MPa）</span>
            <input v-model="registerForm.measuredPressure" placeholder="如 1.42，随检修单留底可追溯" />
          </label>
          <label class="form-item">
            <span>上报巡检队（人）</span>
            <input v-model="registerForm.inspector" placeholder="如 巡检队-王强" />
          </label>
          <label class="form-item">
            <span>检修原因</span>
            <textarea v-model="registerForm.reason" rows="2" placeholder="本次检修原因"></textarea>
          </label>
          <label class="form-item">
            <span>上报日期</span>
            <input v-model="registerForm.reportedAt" type="date" />
          </label>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeRegister">取消</button>
            <button class="btn primary" type="submit">提交检修登记</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 完成检修：结果会同步到阀门井待核查清单 -->
    <div v-if="completeTarget" class="modal-mask" @click.self="closeComplete">
      <div class="modal">
        <h3 class="modal-title">完成检修 · {{ completeTarget['管段编号'] }}</h3>
        <form class="modal-form" @submit.prevent="submitComplete">
          <label class="form-item">
            <span>检修结果</span>
            <textarea v-model="completeForm.result" rows="3" placeholder="回填本次检修处置结果，将同步到阀门井待核查清单"></textarea>
          </label>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeComplete">取消</button>
            <button class="btn primary" type="submit">完成并同步阀门井</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 管段详情：与导出清单共用同一份取数口径，附检修单留底 -->
    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal modal-wide">
        <h3 class="modal-title">管段详情 · {{ detail.row['管段编号'] }}</h3>
        <table class="data-table detail-table">
          <tbody>
            <tr v-for="column in columns" :key="column">
              <th>{{ column }}</th>
              <td>{{ detail.row[column] || '—' }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ detail.row.status }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="sub-title">检修单留底（实测值可追溯）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>检修单号</th>
              <th>登记设计压力</th>
              <th>巡检实测压力</th>
              <th>上报巡检队</th>
              <th>检修原因</th>
              <th>上报时间</th>
              <th>状态</th>
              <th>完成时间</th>
              <th>检修结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in detail.orders" :key="order.id">
              <td>{{ order.orderNo }}</td>
              <td>{{ order.designPressure }}</td>
              <td>{{ order.measuredPressure }}</td>
              <td>{{ order.inspector }}</td>
              <td>{{ order.reason }}</td>
              <td>{{ order.reportedAt }}</td>
              <td>{{ order.status }}</td>
              <td>{{ order.completedAt || '—' }}</td>
              <td>{{ order.result || '—' }}</td>
            </tr>
            <tr v-if="!detail.orders.length">
              <td colspan="9" class="empty-state">该管段暂无检修单</td>
            </tr>
          </tbody>
        </table>

        <div class="modal-actions">
          <button class="btn primary" type="button" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  completeMaintenance,
  downloadEntries,
  listEntries,
  moduleMeta,
  registerMaintenance,
  runAction as applyAction,
  getSegmentDetail,
  todayText,
} from '@/api/local-service'
import type { EntryRow, RegisterMaintenanceInput, SegmentDetail } from '@/data/types'

const meta = moduleMeta('primarynet')
const columns = ['管段编号', '起点', '终点', '公称管径', '设计压力', '敷设方式', '保温形式', '管段状态']
const statuses = ['待投运', '运行中', '检修中', '已废弃']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '运行中管段', value: rows.value.filter((row) => String(row.status) === '运行中').length },
  { label: '检修中管段', value: rows.value.filter((row) => String(row.status) === '检修中').length },
  { label: '已废弃管段', value: rows.value.filter((row) => String(row.status) === '已废弃').length },
])

// 可执行动作按状态下发：已报废管段页面上不再给检修入口（服务层同样会挡回）。
function rowActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待投运':
      return ['提交投运', '报废管段']
    case '运行中':
      return ['登记检修', '报废管段']
    case '检修中':
      return ['完成检修']
    default:
      return []
  }
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

const registerTarget = ref<EntryRow | null>(null)
const completeTarget = ref<EntryRow | null>(null)
const detail = ref<SegmentDetail | null>(null)
const formError = ref('')

function emptyRegisterForm(): RegisterMaintenanceInput {
  return { designPressure: '', measuredPressure: '', inspector: '', reason: '', reportedAt: todayText() }
}
const registerForm = ref<RegisterMaintenanceInput>(emptyRegisterForm())
const completeForm = ref({ result: '' })

function flashMessage(ok: boolean, message: string) {
  if (ok) {
    errorMessage.value = ''
    successMessage.value = message
  } else {
    successMessage.value = ''
    errorMessage.value = message
  }
}

function openRegister(row: EntryRow) {
  formError.value = ''
  registerTarget.value = row
  // 默认带出管段台账上的既有设计压力，值仍由登记人核对后随检修单一起落库。
  registerForm.value = { ...emptyRegisterForm(), designPressure: String(row['设计压力'] ?? '') }
}

function closeRegister() {
  registerTarget.value = null
  formError.value = ''
}

function submitRegister() {
  if (!registerTarget.value) {
    return
  }
  const result = registerMaintenance(Number(registerTarget.value.id), registerForm.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeRegister()
  reload()
  flashMessage(true, result.message)
}

function openComplete(row: EntryRow) {
  formError.value = ''
  completeTarget.value = row
  completeForm.value = { result: '' }
}

function closeComplete() {
  completeTarget.value = null
  formError.value = ''
}

function submitComplete() {
  if (!completeTarget.value) {
    return
  }
  const result = completeMaintenance(Number(completeTarget.value.id), completeForm.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeComplete()
  reload()
  flashMessage(true, result.message)
}

function openDetail(row: EntryRow) {
  try {
    detail.value = getSegmentDetail(Number(row.id))
  } catch (error) {
    flashMessage(false, error instanceof Error ? error.message : '管段详情读取失败')
  }
}

function runAction(action: string, row: EntryRow) {
  if (action === '登记检修') {
    openRegister(row)
    return
  }
  if (action === '完成检修') {
    openComplete(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  flashMessage(result.ok, result.message)
  if (result.ok) {
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
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
