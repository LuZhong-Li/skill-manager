<script setup lang="ts">
/**
 * Experience library view: every `pipeline run` leaves one record, and the next run reuses it
 * (prefilled answers, skipped stages). Listing, searching and detail all come from kernel calls.
 */
import { onMounted, ref, watch } from 'vue';
import { localizedFindingsText } from '../i18n/error-text.ts';
import { formatDateTime } from '../i18n/index.ts';
import type { ExperienceDetail, ExperienceSummary, KernelResult } from '../types.ts';

const props = defineProps<{
  run: (argv: string[]) => Promise<KernelResult>;
  busy: boolean;
  focusId: string | null;
}>();

const keyword = ref('');
const records = ref<ExperienceSummary[]>([]);
const detail = ref<ExperienceDetail | null>(null);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const searched = ref(false);
/** Last keyword whose response actually landed; lets the UI (and tests) distinguish in-flight queries. */
const appliedQuery = ref('');
const message = ref('');
// Guards against out-of-order responses: a slower earlier query must never
// overwrite the result of the query the user issued later.
let loadToken = 0;
let detailToken = 0;

function payloadOf(result: KernelResult): Record<string, unknown> {
  return (result.data ?? {}) as Record<string, unknown>;
}

async function load(): Promise<void> {
  const token = ++loadToken;
  loading.value = true;
  message.value = '';
  try {
    const trimmed = keyword.value.trim();
    const result = await props.run(
      trimmed === ''
        ? ['experience', 'list', '--limit', '20']
        : ['experience', 'search', '--query', trimmed],
    );
    if (token !== loadToken) return;
    appliedQuery.value = trimmed;
    if (!result.ok) {
      records.value = [];
      message.value = localizedFindingsText(result.findings);
      return;
    }
    const data = payloadOf(result);
    records.value = (data['experiences'] as ExperienceSummary[] | undefined) ?? [];
  } finally {
    if (token === loadToken) {
      loading.value = false;
      searched.value = true;
    }
  }
}

async function select(id: string): Promise<void> {
  const token = ++detailToken;
  selectedId.value = id;
  detail.value = null;
  message.value = '';
  const result = await props.run(['experience', 'show', id]);
  if (token !== detailToken) return;
  if (!result.ok) {
    message.value = localizedFindingsText(result.findings);
    return;
  }
  detail.value = payloadOf(result) as unknown as ExperienceDetail;
}

async function focusOn(id: string): Promise<void> {
  if (records.value.length === 0) await load();
  const exists = records.value.some((item) => item.id === id);
  if (!exists) await load();
  await select(id);
}

onMounted(async () => {
  await load();
  if (props.focusId !== null) await focusOn(props.focusId);
});

watch(
  () => props.focusId,
  async (next) => {
    if (next !== null) await focusOn(next);
  },
);
</script>

<template>
  <section
    class="content"
    data-testid="experience-view"
    :data-count="records.length"
    :data-query="appliedQuery"
    :data-loading="loading"
  >
    <p class="muted">{{ $t('experience.intro') }}</p>

    <div class="panel wide">
      <div class="row">
        <label>
          <span class="muted">{{ $t('experience.keyword') }}</span>
          <input
            v-model="keyword"
            data-testid="experience-keyword"
            :placeholder="$t('experience.keywordPlaceholder')"
            @keyup.enter="load"
          />
        </label>
        <button data-testid="experience-search" :disabled="busy || loading" @click="load">
          {{ $t('experience.search') }}
        </button>
      </div>
      <p v-if="message !== ''" class="bad" data-testid="experience-message">{{ message }}</p>
      <p v-if="loading" class="muted">{{ $t('experience.loading') }}</p>
    </div>

    <div class="split">
      <div class="panel list">
        <h2 data-testid="experience-count">
          {{ $t('experience.count', { count: records.length }) }}
        </h2>
        <table v-if="records.length > 0" data-testid="experience-list">
          <thead>
            <tr>
              <th>{{ $t('experience.problem') }}</th>
              <th>{{ $t('experience.kind') }}</th>
              <th>{{ $t('experience.createdAt') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in records"
              :key="row.id"
              data-testid="experience-row"
              :data-experience-id="row.id"
              :class="{ selected: row.id === selectedId }"
              @click="select(row.id)"
            >
              <td>{{ row.problem }}</td>
              <td class="muted">{{ row.kind }}</td>
              <td class="muted">{{ formatDateTime(row.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="searched" class="muted" data-testid="experience-empty">
          {{ keyword.trim() === '' ? $t('experience.empty') : $t('experience.noMatch') }}
        </p>
      </div>

      <div class="panel detail" :data-detail-id="detail?.id ?? ''" data-testid="experience-detail">
        <h2>{{ $t('experience.detailTitle') }}</h2>
        <p v-if="detail === null" class="muted" data-testid="experience-select-hint">
          {{ $t('experience.selectHint') }}
        </p>
        <template v-else>
          <h3
            data-testid="experience-detail-problem"
            :data-kind="detail.kind"
            :data-host="detail.host"
          >
            {{ detail.problem }}
          </h3>
          <p class="muted">
            <code>{{ detail.id }}</code>
          </p>
          <dl class="facts">
            <div>
              <dt>{{ $t('experience.kind') }}</dt>
              <dd>{{ detail.kind }}</dd>
            </div>
            <div>
              <dt>{{ $t('experience.host') }}</dt>
              <dd>{{ detail.host }}</dd>
            </div>
            <div>
              <dt>{{ $t('experience.provider') }}</dt>
              <dd>{{ detail.provider ?? $t('common.unknown') }}</dd>
            </div>
            <div>
              <dt>{{ $t('experience.createdAt') }}</dt>
              <dd>{{ formatDateTime(detail.createdAt) }}</dd>
            </div>
            <div v-if="detail.durationMs !== undefined">
              <dt>{{ $t('common.details') }}</dt>
              <dd>{{ $t('experience.duration', { ms: detail.durationMs }) }}</dd>
            </div>
          </dl>

          <h4>{{ $t('experience.stages') }}</h4>
          <p v-if="detail.stages.length === 0" class="muted">{{ $t('common.none') }}</p>
          <ul v-else class="chips">
            <li v-for="stage in detail.stages" :key="stage">{{ stage }}</li>
          </ul>

          <template v-if="detail.skippedStages !== undefined && detail.skippedStages.length > 0">
            <h4>{{ $t('experience.skippedStages') }}</h4>
            <ul class="chips">
              <li v-for="stage in detail.skippedStages" :key="stage">{{ stage }}</li>
            </ul>
          </template>

          <h4>{{ $t('experience.decisions') }}</h4>
          <ul
            v-if="detail.decisions !== undefined && detail.decisions.length > 0"
            class="decisions"
            data-testid="experience-decisions"
          >
            <li v-for="decision in detail.decisions" :key="decision.question">
              <span class="muted">{{ decision.question }}</span>
              <br />
              {{ decision.answer }}
            </li>
          </ul>
          <p v-else class="muted">{{ $t('experience.noDecisions') }}</p>

          <h4>{{ $t('experience.evidence') }}</h4>
          <div v-if="detail.evidence !== undefined" data-testid="experience-evidence">
            <p class="muted">
              <code>{{ detail.evidence.root }}</code>
            </p>
            <ul v-if="detail.evidence.suspects.length > 0" class="suspects">
              <li v-for="item in detail.evidence.suspects" :key="item">
                <code>{{ item }}</code>
              </li>
            </ul>
            <ul v-if="detail.evidence.checks.length > 0" class="suspects">
              <li v-for="item in detail.evidence.checks" :key="item">
                <code>{{ item }}</code>
              </li>
            </ul>
          </div>
          <p v-else class="muted">{{ $t('experience.noEvidence') }}</p>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.2fr);
  gap: calc(var(--space) * 4);
  align-items: start;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  text-align: left;
  padding: calc(var(--space) * 2);
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--text-muted);
  font-weight: 500;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover,
tbody tr.selected {
  background: var(--accent-soft);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: calc(var(--space) * 2);
  margin: 0 0 calc(var(--space) * 3) 0;
  font-size: 12px;
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  margin: 0;
  word-break: break-all;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--space) * 2);
  margin: 0 0 calc(var(--space) * 3) 0;
  padding: 0;
  list-style: none;
}

.chips li {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-muted);
}

.decisions {
  margin: 0 0 calc(var(--space) * 3) 0;
  padding-left: calc(var(--space) * 5);
  font-size: 12px;
}

.decisions li {
  margin-bottom: calc(var(--space) * 2);
}

.suspects {
  margin: 0 0 calc(var(--space) * 2) 0;
  padding-left: calc(var(--space) * 5);
  font-size: 12px;
  word-break: break-all;
}
</style>
