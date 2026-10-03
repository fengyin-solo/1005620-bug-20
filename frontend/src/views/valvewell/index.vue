<template>
  <section class="page" data-module="valvewell">
    <header class="page-head">
      <div>
        <h2>阀门井维护管理</h2>
        <p class="page-desc">维护阀门井，围绕井编号、所属管段、井盖状况、阀门型号做登记、筛选与状态流转；一次管网检修完成后，结果同步进入下方待核查清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记阀门井</button>
        <button class="btn" type="button" @click="exportRows">导出阀门井维护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">检修待核查清单（来自一次管网检修结果）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>井编号</th>
          <th>所属管段</th>
          <th>检修单号</th>
          <th>检修结果</th>
          <th>同步时间</th>
          <th>核查状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in checkItems" :key="item.id" :class="{ 'is-checked': item.checked }">
          <td>{{ item.wellId || '待关联' }}</td>
          <td>{{ item.segmentCode }}</td>
          <td>{{ item.orderNo }}</td>
          <td>{{ item.result }}</td>
          <td>{{ item.syncedAt }}</td>
          <td>{{ item.checked ? `已核查（${item.checker} ${item.checkedAt}）` : '待核查' }}</td>
          <td class="row-actions">
            <button v-if="!item.checked" class="link" type="button" @click="openCheck(item)">核查</button>
            <span v-else>{{ item.remark || '—' }}</span>
          </td>
        </tr>
        <tr v-if="!checkItems.length">
          <td colspan="7" class="empty-state">暂无待核查项，一次管网完成检修后会同步到这里</td>
        </tr>
      </tbody>
    </table>

    <p class="status-legend" style="margin-top: 16px">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无阀门井维护数据，可先登记阀门井</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条阀门井维护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <div v-if="checkTarget" class="modal-mask" @click.self="closeCheck">
      <div class="modal">
        <h3 class="modal-title">阀门井核查 · {{ checkTarget.wellId || checkTarget.segmentCode }}</h3>
        <p class="modal-hint">检修单 {{ checkTarget.orderNo }} 结果：{{ checkTarget.result }}</p>
        <form class="modal-form" @submit.prevent="submitCheck">
          <label class="form-item">
            <span>核查人</span>
            <input v-model="checkForm.checker" placeholder="如 阀门井班-李敏" />
          </label>
          <label class="form-item">
            <span>核查备注</span>
            <textarea v-model="checkForm.remark" rows="2" placeholder="现场复核情况"></textarea>
          </label>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeCheck">取消</button>
            <button class="btn primary" type="submit">提交核查</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  checkValveItem,
  downloadEntries,
  listEntries,
  listValveChecks,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ValveCheckItem } from '@/data/types'

const meta = moduleMeta('valvewell')
const columns = ['井编号', '所属管段', '井盖状况', '阀门型号', '检查人', '检查日期', '养护措施', '井体状态']
const actions = ['提交检查', '确认养护', '提出维修']
const statuses = ['待检查', '检查中', '已养护', '需维修']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const checkItems = ref<ValveCheckItem[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待检查阀门井', value: rows.value.filter((row) => String(row.status) === '待检查').length },
  { label: '已养护阀门井', value: rows.value.filter((row) => String(row.status) === '已养护').length },
  { label: '需维修阀门井', value: rows.value.filter((row) => String(row.status) === '需维修').length },
  { label: '检修待核查项', value: checkItems.value.filter((item) => !item.checked).length },
])

const checkTarget = ref<ValveCheckItem | null>(null)
const checkForm = ref({ checker: '', remark: '' })
const formError = ref('')

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '阀门井登记入口尚未接入审批流'
}

function openCheck(item: ValveCheckItem) {
  formError.value = ''
  checkTarget.value = item
  checkForm.value = { checker: '', remark: '' }
}

function closeCheck() {
  checkTarget.value = null
  formError.value = ''
}

function submitCheck() {
  if (!checkTarget.value) {
    return
  }
  const result = checkValveItem(checkTarget.value.id, checkForm.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeCheck()
  reload()
  successMessage.value = result.message
  errorMessage.value = ''
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 待核查清单按同步时间倒序，已核查项保留记录可追溯，但排在后面。
    checkItems.value = listValveChecks(false)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '阀门井维护列表读取失败'
  }
}

onMounted(reload)
</script>
