<script setup lang="ts">
/** 仪表盘：空工作区引导、未管理引导、筛选空态与 Skill 卡片列表。 */
import SkillCard from './SkillCard.vue';
import type { SkillSummary } from '../types.ts';

defineProps<{
  initialized: boolean;
  /** 已应用检索与筛选后的可见列表 */
  records: SkillSummary[];
  /** 筛选前的总数：>0 而可见为空时是「筛选无结果」，不是「没有 Skill」 */
  total: number;
}>();

defineEmits<{
  init: [];
  scan: [];
  inventory: [];
  open: [record: SkillSummary];
  resetFilters: [];
}>();
</script>

<template>
  <section class="content" data-testid="dashboard-view">
    <div v-if="!initialized" class="empty">
      <h2>{{ $t('dashboard.uninitializedTitle') }}</h2>
      <p class="muted">{{ $t('dashboard.uninitializedBody') }}</p>
      <div class="empty-actions">
        <button class="primary" data-testid="dashboard-init" @click="$emit('init')">
          {{ $t('dashboard.initialize') }}
        </button>
        <button data-testid="open-inventory" @click="$emit('inventory')">
          {{ $t('dashboard.inventoryInstalled') }}
        </button>
      </div>
      <p class="muted hint">{{ $t('dashboard.inventoryHint') }}</p>
    </div>
    <div v-else-if="total === 0" class="empty">
      <h2>{{ $t('dashboard.emptyTitle') }}</h2>
      <p class="muted">{{ $t('dashboard.emptyBody') }}</p>
      <div class="empty-actions">
        <button class="primary" data-testid="dashboard-scan" @click="$emit('scan')">
          {{ $t('dashboard.scanNow') }}
        </button>
        <button data-testid="open-inventory" @click="$emit('inventory')">
          {{ $t('dashboard.inventoryInstalled') }}
        </button>
      </div>
    </div>
    <div v-else-if="records.length === 0" class="empty" data-testid="dashboard-filter-empty">
      <h2>{{ $t('dashboard.filterEmptyTitle') }}</h2>
      <p class="muted">{{ $t('dashboard.filterEmptyBody') }}</p>
      <div class="empty-actions">
        <button
          class="primary"
          data-testid="dashboard-reset-filters"
          @click="$emit('resetFilters')"
        >
          {{ $t('dashboard.resetFilters') }}
        </button>
      </div>
    </div>
    <div v-else class="grid" data-testid="skill-grid">
      <SkillCard
        v-for="record in records"
        :key="record.id"
        :record="record"
        @open="$emit('open', record)"
      />
    </div>
  </section>
</template>

<style scoped>
.content {
  flex: 1;
  overflow: auto;
  padding: calc(var(--space) * 5);
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 4);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: calc(var(--space) * 4);
}

.empty {
  margin: auto;
  text-align: center;
  display: grid;
  gap: calc(var(--space) * 3);
  justify-items: center;
  max-width: 460px;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--space) * 2);
  justify-content: center;
}

.hint {
  font-size: 12px;
}
</style>
