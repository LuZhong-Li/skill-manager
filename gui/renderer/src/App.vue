<script setup lang="ts">
/**
 * 应用外壳：侧边导航 + 顶部工具栏 + 主体 + 底部状态栏。
 *
 * 界面只做三件事：把用户操作翻译成一次内核调用、把内核结果如实呈现、把写操作交给
 * 「预览 → 确认 → 执行」的统一流程。这里不推导业务状态，也不读写工作区文件。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DashboardView from './components/DashboardView.vue';
import DetailDialog from './components/DetailDialog.vue';
import InstallDialog from './components/InstallDialog.vue';
import ValidationDialog from './components/ValidationDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import UpdateCheckDialog from './components/UpdateCheckDialog.vue';
import PluginPanel from './components/PluginPanel.vue';
import PluginInstallDialog from './components/PluginInstallDialog.vue';
import PluginDetailDialog from './components/PluginDetailDialog.vue';
import HostInventoryView from './components/HostInventoryView.vue';
import PipelineView from './components/PipelineView.vue';
import ExperienceView from './components/ExperienceView.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { useKernel } from './composables/useKernel.ts';
import { exportInventory } from './composables/useInventoryExport.ts';
import { runSequentialUpdates, type UpdateRunResult } from './update-runner.ts';
import { pluginInstallNotice } from './plugin-presentation.ts';
import { localizedFindingsText } from './i18n/error-text.ts';
import { t, type SupportedLocale } from './i18n/index.ts';
import {
  languageMode,
  manualLanguage,
  resolvedLocale,
  setLanguagePreference,
  systemLocale,
  type LanguageMode,
} from './i18n/language.ts';
import {
  cardStateOf,
  type BackupRow,
  type KernelResult,
  type PluginCandidate,
  type PluginHosts,
  type PluginSummary,
  type SkillSummary,
  type UpdateCheckReport,
  type UpdateSettings,
} from './types.ts';

type View =
  | 'dashboard'
  | 'inventory'
  | 'validation'
  | 'backup'
  | 'plugins'
  | 'pipeline'
  | 'experience'
  | 'settings';

const kernel = useKernel();
const view = ref<View>('dashboard');
const experienceFocus = ref<string | null>(null);
const filterState = ref('');
const selected = ref<SkillSummary | null>(null);
const detail = ref<KernelResult | null>(null);
const detailLoading = ref(false);
const showInstall = ref(false);
const report = ref<KernelResult | null>(null);
const exportPath = ref('backups/export.yaml');
const importPath = ref('backups/export.yaml');
const configResult = ref<KernelResult | null>(null);
const configError = ref<KernelResult | null>(null);
const configKey = ref('default_target');
const configValue = ref('');
const backups = ref<BackupRow[]>([]);
const backupFilter = ref('');
const backupLoaded = ref(false);
const updateReport = ref<UpdateCheckReport | null>(null);
const showUpdates = ref(false);
const updateBusy = ref(false);
const updatingId = ref<string | null>(null);
const updateResults = ref<Record<string, UpdateRunResult>>({});
const updateBadge = ref(false);
const updateError = ref('');
const pluginRecords = ref<PluginSummary[]>([]);
const pluginCandidates = ref<PluginCandidate[]>([]);
const pluginHosts = ref<PluginHosts>({ builtin: [], third_party: [] });
const pluginLoading = ref(false);
const pluginMessage = ref('');
const pluginSelected = ref<PluginSummary | null>(null);
const pluginDetail = ref<KernelResult | null>(null);
const pluginDetailLoading = ref(false);
const showPluginInstall = ref(false);
const updateSettings = ref<UpdateSettings>({
  periodic_check_enabled: false,
  instant_check_enabled: false,
});
let unsubscribeUpdates: (() => void) | null = null;

const visibleRecords = computed(() =>
  filterState.value === ''
    ? kernel.records.value
    : kernel.records.value.filter((record) => cardStateOf(record) === filterState.value),
);
const states = computed(() => kernel.summarizeStates());

async function openDetail(record: SkillSummary): Promise<void> {
  selected.value = record;
  detail.value = null;
  detailLoading.value = true;
  detail.value = await kernel.run(['inspect', record.id]);
  detailLoading.value = false;
}

async function loadPlugins(): Promise<void> {
  pluginLoading.value = true;
  pluginMessage.value = '';
  try {
    const hostResponse = (await globalThis.window.skillManager.plugins.hosts()) as {
      result?: KernelResult;
      builtin?: PluginHosts['builtin'];
      third_party?: PluginHosts['third_party'];
    };
    const result = hostResponse.result;
    const data = result?.data ?? {};
    pluginRecords.value = (data['plugins'] ?? []) as PluginSummary[];
    pluginHosts.value = {
      builtin: hostResponse.builtin ?? [],
      third_party: hostResponse.third_party ?? [],
    };
    const scan = (await globalThis.window.skillManager.plugins.scan()) as KernelResult;
    pluginCandidates.value = (scan.data?.['unregistered'] ?? []) as PluginCandidate[];
    if (result !== undefined && !result.ok) {
      pluginMessage.value = localizedFindingsText(result.findings);
    }
  } catch (error) {
    pluginMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    pluginLoading.value = false;
  }
}

function openPlugins(): void {
  view.value = 'plugins';
  void loadPlugins();
}

async function openPluginDetail(id: string): Promise<void> {
  pluginSelected.value = pluginRecords.value.find((item) => item.id === id) ?? null;
  pluginDetail.value = null;
  pluginDetailLoading.value = true;
  try {
    pluginDetail.value = (await globalThis.window.skillManager.plugins.inspect(id)) as KernelResult;
  } finally {
    pluginDetailLoading.value = false;
  }
}

async function installPlugin(source: string): Promise<void> {
  showPluginInstall.value = false;
  const result = await kernel.runWithConfirm(
    ['install', source, '--kind', 'plugin'],
    t('plugins.installTitle'),
  );
  if (result?.ok === true) {
    pluginMessage.value = pluginInstallNotice();
    await loadPlugins();
  } else if (result !== null) {
    pluginMessage.value = localizedFindingsText(result.findings);
  }
}

async function togglePlugin(action: 'enable' | 'disable', id: string): Promise<void> {
  const result = await kernel.runWithConfirm(
    [action, id, '--kind', 'plugin'],
    action === 'enable' ? t('plugins.enableTitle', { id }) : t('plugins.disableTitle', { id }),
  );
  if (result !== null) await loadPlugins();
  if (result !== null && !result.ok) {
    pluginMessage.value = localizedFindingsText(result.findings);
  }
}

async function uninstallPlugin(id: string): Promise<void> {
  const result = await kernel.runWithConfirm(
    ['uninstall', id, '--kind', 'plugin'],
    t('plugins.uninstallTitle', { id }),
  );
  if (result !== null) {
    pluginSelected.value = null;
    await loadPlugins();
    if (!result.ok) {
      pluginMessage.value = localizedFindingsText(result.findings);
    }
  }
}

async function distributePlugin(hostId: string, skillId: string): Promise<void> {
  if (skillId === '') {
    pluginMessage.value = t('plugins.chooseSkillFirst');
    return;
  }
  const result = await kernel.runWithConfirm(
    ['update', skillId, '--host', hostId],
    t('plugins.distributeTitle', { skill: skillId, host: hostId }),
  );
  if (result?.ok === true) {
    pluginMessage.value = t('plugins.distributed', { skill: skillId, host: hostId });
    await loadPlugins();
  }
}

function usePluginConfigHint(hint: string): void {
  const parts = hint.match(/^config set (\S+) (.*)$/);
  view.value = 'settings';
  if (parts !== null) {
    configKey.value = parts[1] ?? '';
    configValue.value = '';
  }
}

function openExperience(id: string): void {
  experienceFocus.value = id;
  view.value = 'experience';
}

function openExperienceLibrary(): void {
  experienceFocus.value = null;
  view.value = 'experience';
}

function openPipeline(): void {
  experienceFocus.value = null;
  view.value = 'pipeline';
}

/** 写操作的统一入口：预览 → 确认 → 执行，取消时不发写请求 */
async function act(argv: string[], title: string): Promise<KernelResult | null> {
  const result = await kernel.runWithConfirm(argv, title);
  if (result !== null) {
    selected.value = null;
    await kernel.refresh();
  }
  return result;
}

async function runValidate(): Promise<void> {
  report.value = await kernel.run(['validate']);
}

async function runExport(): Promise<void> {
  const result = await kernel.run(['export', exportPath.value.trim()]);
  if (result.ok) report.value = null;
}

async function runImport(): Promise<void> {
  await act(['import', importPath.value.trim()], t('backup.importAction'));
}

/** 读取可用备份列表：数据来自内核的 restore --list，界面不直读备份目录 */
async function loadBackups(): Promise<void> {
  const id = backupFilter.value.trim();
  const result = await kernel.run(['restore', ...(id === '' ? [] : [id]), '--list']);
  backups.value = (result.data?.['backups'] as BackupRow[] | undefined) ?? [];
  backupLoaded.value = true;
}

/** 恢复一份备份：预览 → 确认 → 带 --yes 执行，取消时不发写请求 */
async function restoreBackup(row: BackupRow): Promise<void> {
  await act(
    ['restore', row.id, '--timestamp', row.timestamp],
    t('backup.restoreAction', { id: row.id }),
  );
  await loadBackups();
}

async function loadConfig(): Promise<void> {
  configResult.value = await kernel.run(['config', 'get']);
}

async function saveConfig(): Promise<void> {
  const result = await act(
    ['config', 'set', configKey.value, configValue.value],
    t('settings.write'),
  );
  await loadConfig();
  configError.value = result !== null && !result.ok ? result : null;
}

function hasAvailable(report: UpdateCheckReport): boolean {
  return report.data.items.some((item) => item.state === 'update-available');
}

function acceptUpdateReport(report: UpdateCheckReport, open: boolean): void {
  updateReport.value = report;
  updateError.value = '';
  if (open) {
    showUpdates.value = true;
    updateBadge.value = false;
  } else {
    updateBadge.value = !showUpdates.value && hasAvailable(report);
  }
}

async function loadUpdateState(): Promise<void> {
  try {
    const [settings, latest] = await Promise.all([
      globalThis.window.skillManager.updates.getSettings(),
      globalThis.window.skillManager.updates.latest(),
    ]);
    updateSettings.value = settings as UpdateSettings;
    if (latest !== null) {
      const report = latest as UpdateCheckReport;
      updateReport.value = report;
      updateBadge.value = hasAvailable(report);
    }
  } catch (error) {
    updateError.value = error instanceof Error ? error.message : String(error);
  }
}

async function runUpdateCheck(open = true): Promise<void> {
  updateBusy.value = true;
  try {
    const report = (await globalThis.window.skillManager.updates.check()) as UpdateCheckReport;
    acceptUpdateReport(report, open);
  } catch (error) {
    updateError.value = error instanceof Error ? error.message : String(error);
  } finally {
    updateBusy.value = false;
  }
}

async function openUpdates(): Promise<void> {
  if (updateBadge.value && updateReport.value !== null) {
    updateBadge.value = false;
    showUpdates.value = true;
    return;
  }
  await runUpdateCheck(true);
}

async function toggleUpdateSetting(key: keyof UpdateSettings, enabled: boolean): Promise<void> {
  const previous = updateSettings.value;
  updateSettings.value = { ...previous, [key]: enabled };
  try {
    updateSettings.value = (await globalThis.window.skillManager.updates.setSettings({
      [key]: enabled,
    })) as UpdateSettings;
    updateError.value = '';
  } catch (error) {
    updateSettings.value = previous;
    updateError.value = error instanceof Error ? error.message : String(error);
  }
}

function togglePeriodic(enabled: boolean): void {
  void toggleUpdateSetting('periodic_check_enabled', enabled);
}

function toggleInstant(enabled: boolean): void {
  void toggleUpdateSetting('instant_check_enabled', enabled);
}

async function performUpdate(id: string, ref: string | undefined) {
  updatingId.value = id;
  try {
    const result = await kernel.runWithConfirm(
      ['update', id, ...(ref === undefined ? [] : ['--ref', ref])],
      t('updates.updateAction', { id }),
    );
    return { cancelled: result === null, result };
  } finally {
    updatingId.value = null;
  }
}

function mergeResults(results: UpdateRunResult[]): void {
  const next = { ...updateResults.value };
  for (const result of results) next[result.id] = result;
  updateResults.value = next;
}

async function refreshAfterUpdates(): Promise<void> {
  await kernel.refresh();
  await runUpdateCheck(false);
}

async function updateOne(id: string): Promise<void> {
  const target = updateReport.value?.data.items.find((item) => item.id === id)?.available?.ref;
  if (target === undefined) return;
  updateBusy.value = true;
  try {
    mergeResults(await runSequentialUpdates([id], (itemId) => performUpdate(itemId, target)));
    await refreshAfterUpdates();
  } finally {
    updateBusy.value = false;
  }
}

async function updateAll(): Promise<void> {
  const report = updateReport.value;
  if (report === null) return;
  const ids =
    report.data.items.filter((item) => item.state === 'update-available').map((item) => item.id) ??
    [];
  if (ids.length === 0) return;
  const targets = new Map(
    report.data.items
      .filter((item) => item.state === 'update-available')
      .map((item) => [item.id, item.available?.ref]),
  );
  updateBusy.value = true;
  try {
    updateResults.value = {};
    mergeResults(await runSequentialUpdates(ids, (id) => performUpdate(id, targets.get(id))));
    await refreshAfterUpdates();
  } finally {
    updateBusy.value = false;
  }
}

onMounted(async () => {
  unsubscribeUpdates = globalThis.window.skillManager.updates.onReport((report) => {
    acceptUpdateReport(report as UpdateCheckReport, false);
  });
  await kernel.describe();
  await kernel.refresh();
  await loadUpdateState();
});

onBeforeUnmount(() => unsubscribeUpdates?.());

function changeLanguage(mode: LanguageMode, value: SupportedLocale): void {
  void setLanguagePreference(mode, value);
}
</script>

<template>
  <div class="shell">
    <aside>
      <h1>skill-manager</h1>
      <p class="muted workspace" :title="kernel.workspace.value">{{ kernel.workspace.value }}</p>
      <nav>
        <button :class="{ active: view === 'dashboard' }" @click="view = 'dashboard'">
          {{ $t('nav.dashboard') }}
        </button>
        <button :class="{ active: view === 'validation' }" @click="view = 'validation'">
          {{ $t('nav.validation') }}
        </button>
        <button :class="{ active: view === 'backup' }" @click="view = 'backup'">
          {{ $t('nav.backup') }}
        </button>
        <button data-nav="plugins" :class="{ active: view === 'plugins' }" @click="openPlugins">
          {{ $t('nav.plugins') }}
        </button>
        <button
          data-nav="inventory"
          :class="{ active: view === 'inventory' }"
          @click="view = 'inventory'"
        >
          {{ $t('nav.inventory') }}
        </button>
        <button data-nav="pipeline" :class="{ active: view === 'pipeline' }" @click="openPipeline">
          {{ $t('nav.pipeline') }}
        </button>
        <button
          data-nav="experience"
          :class="{ active: view === 'experience' }"
          @click="openExperienceLibrary"
        >
          {{ $t('nav.experience') }}
        </button>
        <button :class="{ active: view === 'settings' }" @click="view = 'settings'">
          {{ $t('nav.settings') }}
        </button>
      </nav>
      <dl class="counts">
        <div>
          <dt>{{ $t('common.enabled') }}</dt>
          <dd>{{ states.enabled }}</dd>
        </div>
        <div>
          <dt>{{ $t('common.disabled') }}</dt>
          <dd>{{ states.disabled }}</dd>
        </div>
        <div>
          <dt>{{ $t('common.invalid') }}</dt>
          <dd>{{ states.invalid }}</dd>
        </div>
      </dl>
    </aside>

    <main>
      <header
        v-if="view !== 'inventory' && view !== 'pipeline' && view !== 'experience'"
        class="toolbar"
      >
        <button class="primary" :disabled="kernel.busy.value" @click="showInstall = true">
          {{ $t('toolbar.installSkill') }}
        </button>
        <button :disabled="kernel.busy.value" @click="kernel.run(['scan']).then(kernel.refresh)">
          {{ $t('toolbar.rescan') }}
        </button>
        <button :disabled="kernel.busy.value" @click="runValidate">
          {{ $t('toolbar.validateAll') }}
        </button>
        <button :disabled="kernel.busy.value" @click="runExport">
          {{ $t('toolbar.exportBackup') }}
        </button>
        <button :disabled="kernel.busy.value" @click="runImport">
          {{ $t('toolbar.importBackup') }}
        </button>
        <button
          v-if="view !== 'plugins'"
          class="update-check"
          :disabled="kernel.busy.value || updateBusy"
          @click="openUpdates"
        >
          {{ $t('toolbar.checkUpdates') }}
          <span
            v-if="updateBadge"
            class="update-dot"
            :aria-label="$t('toolbar.updatesAvailable')"
          />
        </button>
        <span class="spacer" />
        <select v-model="filterState" class="filter" :aria-label="$t('toolbar.filterAria')">
          <option value="">{{ $t('common.allStates') }}</option>
          <option value="enabled">{{ $t('toolbar.enabledOnly') }}</option>
          <option value="disabled">{{ $t('toolbar.disabledOnly') }}</option>
          <option value="invalid">{{ $t('toolbar.invalidOnly') }}</option>
        </select>
      </header>
      <header v-else-if="view === 'inventory'" class="toolbar">
        <strong>{{ $t('inventory.title') }}</strong>
        <span class="muted">{{ $t('app.readOnly') }}</span>
        <span class="spacer" />
      </header>
      <header v-else class="toolbar">
        <strong>{{ view === 'pipeline' ? $t('pipeline.title') : $t('experience.title') }}</strong>
        <span class="spacer" />
      </header>

      <DashboardView
        v-if="view === 'dashboard'"
        :initialized="kernel.initialized.value"
        :records="visibleRecords"
        @init="kernel.run(['init']).then(kernel.refresh)"
        @scan="kernel.run(['scan']).then(kernel.refresh)"
        @inventory="view = 'inventory'"
        @open="openDetail"
      />

      <HostInventoryView
        v-else-if="view === 'inventory'"
        :run="kernel.run"
        :export-inventory="exportInventory"
      />

      <PipelineView
        v-else-if="view === 'pipeline'"
        :run="kernel.run"
        :busy="kernel.busy.value"
        :workspace="kernel.workspace.value"
        @open-experience="openExperience"
      />

      <ExperienceView
        v-else-if="view === 'experience'"
        :run="kernel.run"
        :busy="kernel.busy.value"
        :focus-id="experienceFocus"
      />

      <section v-else-if="view === 'validation'" class="content">
        <p class="muted">{{ $t('validation.intro') }}</p>
        <button class="primary" :disabled="kernel.busy.value" @click="runValidate">
          {{ $t('validation.run') }}
        </button>
        <div v-if="report" class="panel">
          <p>
            {{
              $t('validation.summary', {
                exitCode: report.exit_code,
                passed: (report.data?.['passed'] as number) ?? 0,
                invalid: (report.data?.['invalid'] as number) ?? 0,
                findings: report.findings.length,
              })
            }}
          </p>
          <p class="muted">{{ $t('validation.dialogOpen') }}</p>
        </div>
      </section>

      <section v-else-if="view === 'backup'" class="content">
        <div class="panel wide">
          <h2>{{ $t('backup.restoreTitle') }}</h2>
          <div class="row">
            <label>
              <span class="muted">{{ $t('backup.filter') }}</span>
              <input v-model="backupFilter" :placeholder="$t('backup.filterPlaceholder')" />
            </label>
            <button :disabled="kernel.busy.value" @click="loadBackups">
              {{ $t('backup.readList') }}
            </button>
          </div>
          <p class="muted">{{ $t('backup.listHint') }}</p>
          <table v-if="backups.length > 0" class="backups">
            <thead>
              <tr>
                <th>Skill</th>
                <th>{{ $t('backup.timestamp') }}</th>
                <th>{{ $t('backup.type') }}</th>
                <th>{{ $t('backup.files') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in backups" :key="`${row.id}@${row.timestamp}`">
                <td>
                  <code>{{ row.id }}</code>
                </td>
                <td>
                  <code>{{ row.timestamp }}</code>
                </td>
                <td class="muted">{{ row.type }}</td>
                <td class="muted">{{ row.file_count }}</td>
                <td>
                  <button :disabled="kernel.busy.value" @click="restoreBackup(row)">
                    {{ $t('backup.restore') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="backupLoaded" class="muted">{{ $t('backup.empty') }}</p>
          <p v-else class="muted">{{ $t('backup.notLoaded') }}</p>
        </div>
        <div class="panel">
          <h2>{{ $t('backup.exportTitle') }}</h2>
          <label>
            <span class="muted">{{ $t('backup.exportPath') }}</span>
            <input v-model="exportPath" />
          </label>
          <button class="primary" :disabled="kernel.busy.value" @click="runExport">
            {{ $t('common.export') }}
          </button>
        </div>
        <div class="panel">
          <h2>{{ $t('backup.importTitle') }}</h2>
          <label>
            <span class="muted">{{ $t('backup.importPath') }}</span>
            <input v-model="importPath" />
          </label>
          <p class="muted">{{ $t('backup.importHint') }}</p>
          <button :disabled="kernel.busy.value" @click="runImport">
            {{ $t('common.import') }}
          </button>
        </div>
      </section>

      <PluginPanel
        v-else-if="view === 'plugins'"
        :plugins="pluginRecords"
        :candidates="pluginCandidates"
        :hosts="pluginHosts"
        :skills="kernel.records.value"
        :loading="pluginLoading"
        :message="pluginMessage"
        @refresh="loadPlugins"
        @install="showPluginInstall = true"
        @install-candidate="installPlugin"
        @open="openPluginDetail"
        @enable="(id) => togglePlugin('enable', id)"
        @disable="(id) => togglePlugin('disable', id)"
        @uninstall="uninstallPlugin"
        @distribute="distributePlugin"
        @config-hint="usePluginConfigHint"
      />
      <section v-else class="content">
        <SettingsPanel
          :busy="kernel.busy.value"
          :config-result="configResult"
          :config-error="configError"
          :config-key="configKey"
          :config-value="configValue"
          :update-settings="updateSettings"
          :update-error="updateError"
          :language-mode="languageMode"
          :manual-language="manualLanguage"
          :system-locale="systemLocale"
          :resolved-locale="resolvedLocale"
          @load-config="loadConfig"
          @save-config="saveConfig"
          @update:config-key="configKey = $event"
          @update:config-value="configValue = $event"
          @toggle-periodic="togglePeriodic"
          @toggle-instant="toggleInstant"
          @change-language="changeLanguage"
        />
      </section>
    </main>

    <footer class="statusbar">
      <span v-if="kernel.log.value.length === 0" class="muted">
        {{ $t('app.operationLog') }}
      </span>
      <span
        v-for="entry in kernel.log.value.slice(0, 3)"
        :key="entry.at + entry.text"
        :class="{ bad: !entry.ok }"
      >
        {{ entry.at }} {{ entry.text }}
      </span>
    </footer>

    <DetailDialog
      v-if="selected"
      :record="selected"
      :detail="detail"
      :loading="detailLoading"
      @close="selected = null"
      @action="(argv) => act(argv, $t('app.executingAction'))"
      @deps="
        async () => {
          if (selected) detail = await kernel.run(['deps', selected.id, '--tree']);
        }
      "
      @validate="runValidate"
    />
    <InstallDialog
      v-if="showInstall"
      @close="showInstall = false"
      @submit="
        (argv) => {
          showInstall = false;
          void act(argv, $t('install.title'));
        }
      "
    />
    <PluginInstallDialog
      v-if="showPluginInstall"
      @close="showPluginInstall = false"
      @submit="installPlugin"
    />
    <PluginDetailDialog
      v-if="pluginSelected"
      :plugin="pluginSelected"
      :detail="pluginDetail"
      :loading="pluginDetailLoading"
      @close="pluginSelected = null"
      @enable="(id) => togglePlugin('enable', id)"
      @disable="(id) => togglePlugin('disable', id)"
      @uninstall="uninstallPlugin"
    />
    <ValidationDialog v-if="report && view !== 'backup'" :result="report" @close="report = null" />
    <UpdateCheckDialog
      v-if="showUpdates && updateReport"
      :report="updateReport"
      :busy="updateBusy"
      :updating-id="updatingId"
      :results="updateResults"
      @close="showUpdates = false"
      @retry="runUpdateCheck(true)"
      @update="updateOne"
      @update-all="updateAll"
    />
    <ConfirmDialog
      v-if="kernel.pendingConfirm.value"
      :request="kernel.pendingConfirm.value"
      @answer="kernel.answerConfirm"
    />
  </div>
</template>

<style scoped src="./app-shell.css"></style>
