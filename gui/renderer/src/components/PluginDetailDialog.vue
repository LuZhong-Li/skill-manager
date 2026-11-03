<script setup lang="ts">
/** 插件详情：manifest、canonical 宿主、校验结论与 landings 账本均来自内核。 */
import { computed } from 'vue';
import DialogShell from './DialogShell.vue';
import type { Finding, KernelResult, PluginSummary } from '../types.ts';
import { pluginStateLabel } from '../plugin-presentation.ts';
import { localizedFindingText } from '../i18n/error-text.ts';

const props = defineProps<{
  plugin: PluginSummary;
  detail: KernelResult | null;
  loading: boolean;
}>();
const emit = defineEmits<{
  close: [];
  enable: [id: string];
  disable: [id: string];
  uninstall: [id: string];
}>();

const data = computed(() => (props.detail?.data ?? {}) as Record<string, unknown>);
const record = computed(() => (data.value['plugin'] ?? {}) as Record<string, unknown>);
const manifest = computed(() => (data.value['manifest'] ?? null) as Record<string, unknown> | null);
const hosts = computed(() => (record.value['hosts'] ?? []) as Array<Record<string, unknown>>);
const landings = computed(() => (data.value['landings'] ?? []) as Array<Record<string, unknown>>);
const rootConfig = computed(
  () => (data.value['root_config'] ?? []) as Array<Record<string, unknown>>,
);
const findings = computed<Finding[]>(() => props.detail?.findings ?? []);
</script>

<template>
  <DialogShell
    :title="plugin.id"
    :subtitle="$t('plugins.detailSubtitle')"
    wide
    @close="$emit('close')"
  >
    <p v-if="loading" class="muted">{{ $t('plugins.loadingDetail') }}</p>
    <template v-else>
      <section>
        <h3>{{ $t('plugins.statusManifest') }}</h3>
        <dl class="grid">
          <div>
            <dt>{{ $t('plugins.status') }}</dt>
            <dd data-testid="plugin-detail-state" :data-plugin-state="plugin.state">
              {{ pluginStateLabel(plugin.state) }}
            </dd>
          </div>
          <div>
            <dt>{{ $t('plugins.version') }}</dt>
            <dd>{{ plugin.version }}</dd>
          </div>
          <div>
            <dt>{{ $t('plugins.manifestHash') }}</dt>
            <dd>
              <code>{{ String(data['manifest_hash'] ?? $t('plugins.unreadable')) }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ $t('plugins.capabilities') }}</dt>
            <dd>
              {{
                String(
                  (manifest?.['capabilities'] as unknown[])?.join(', ') ?? $t('plugins.notRead'),
                )
              }}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>{{ $t('plugins.canonicalHosts') }}</h3>
        <ul>
          <li v-for="host in hosts" :key="String(host['host_id'])">
            <code>{{ String(host['host_id']) }}</code>
            <span class="muted"
              >{{ String(host['display_name'] ?? '') }} / {{ String(host['form'] ?? '') }}</span
            >
          </li>
        </ul>
        <p v-if="hosts.length === 0" class="muted">{{ $t('plugins.noHosts') }}</p>
      </section>

      <section>
        <h3>{{ $t('plugins.validation') }}</h3>
        <p v-if="plugin.validation.status === 'ok'" class="ok">{{ $t('plugins.passed') }}</p>
        <p v-else class="bad">
          {{ $t('plugins.validationFailed', { errors: plugin.validation.errors.join(', ') }) }}
        </p>
        <ul>
          <li v-for="finding in findings" :key="finding.code + finding.target">
            {{ localizedFindingText(finding) }}
          </li>
        </ul>
      </section>

      <section>
        <h3>{{ $t('plugins.landings') }}</h3>
        <ul>
          <li
            v-for="landing in landings"
            :key="String(landing['target_path'])"
            :data-landing="landing['target_path']"
          >
            <code>{{ String(landing['target_path']) }}</code>
            <span class="muted"
              >{{ String(landing['state']) }}｜{{ String(landing['skill_id']) }}</span
            >
          </li>
        </ul>
        <p v-if="landings.length === 0" class="muted">{{ $t('plugins.noLandings') }}</p>
      </section>

      <section>
        <h3>{{ $t('plugins.rootConfig') }}</h3>
        <ul>
          <li v-for="host in rootConfig" :key="String(host['host_id'])">
            <code>{{ String(host['host_id']) }}</code>
            <span
              v-for="key in host['keys'] as Array<Record<string, unknown>>"
              :key="String(key['key'])"
            >
              {{ String(key['key']) }}={{ String(key['value'] ?? $t('plugins.notConfigured')) }}
            </span>
          </li>
        </ul>
      </section>
    </template>

    <template #footer>
      <button v-if="plugin.state !== 'enabled'" @click="emit('enable', plugin.id)">
        {{ $t('plugins.enable') }}
      </button>
      <button v-else @click="emit('disable', plugin.id)">{{ $t('plugins.disable') }}</button>
      <button class="danger" @click="emit('uninstall', plugin.id)">
        {{ $t('plugins.uninstallPlugin') }}
      </button>
    </template>
  </DialogShell>
</template>

<style scoped>
section + section {
  margin-top: calc(var(--space) * 5);
}

h3 {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: calc(var(--space) * 2);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: calc(var(--space) * 2) calc(var(--space) * 4);
  margin: 0;
  font-size: 13px;
}

.grid div {
  display: flex;
  gap: calc(var(--space) * 2);
}

dt {
  color: var(--text-muted);
  min-width: 72px;
}

dd {
  margin: 0;
  word-break: break-all;
}

ul {
  margin: 0;
  padding-left: calc(var(--space) * 5);
  font-size: 13px;
}

code {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
}

.ok {
  color: var(--success);
}

.bad {
  color: var(--danger);
}
</style>
