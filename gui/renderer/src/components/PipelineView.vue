<script setup lang="ts">
/**
 * Problem handling view: one kernel call (`pipeline run`) turns a problem statement into
 * a document package and an experience record. The view never derives state of its own:
 * every path, count and attribution comes from the kernel payload.
 */
import { computed, ref } from 'vue';
import { localizedFindingsText } from '../i18n/error-text.ts';
import { t } from '../i18n/index.ts';
import type { KernelResult, PipelineRunData } from '../types.ts';

const props = defineProps<{
  run: (argv: string[]) => Promise<KernelResult>;
  busy: boolean;
  workspace: string;
}>();

const emit = defineEmits<{ (event: 'open-experience', id: string): void }>();

const problem = ref('');
const probeRoot = ref('');
const outputDir = ref('');
const dryRun = ref(false);
const running = ref(false);
const result = ref<KernelResult | null>(null);
const message = ref('');

const effectiveOutputDir = computed(() => {
  const explicit = outputDir.value.trim();
  if (explicit !== '') return explicit;
  return props.workspace === '' ? 'pipeline-output' : `${props.workspace}/pipeline-output`;
});

const data = computed<PipelineRunData | null>(() => {
  const payload = result.value?.data as PipelineRunData | undefined;
  return payload === undefined ? null : payload;
});

const findingsText = computed(() =>
  result.value !== null && !result.value.ok ? localizedFindingsText(result.value.findings) : '',
);

const adaptationText = computed(() => {
  const adaptation = data.value?.experience_adapted;
  if (adaptation === undefined || adaptation.sample_size === 0) return t('pipeline.adaptedNone');
  return t('pipeline.adapted', {
    samples: adaptation.sample_size,
    prefilled: adaptation.prefilled_questions.length,
    skipped: adaptation.skipped_stages.length,
  });
});

async function runNow(): Promise<void> {
  if (running.value) return;
  if (problem.value.trim() === '') {
    message.value = t('pipeline.missingProblem');
    return;
  }
  running.value = true;
  message.value = '';
  try {
    const argv = [
      'pipeline',
      'run',
      '--problem',
      problem.value.trim(),
      '--output-dir',
      effectiveOutputDir.value,
    ];
    if (probeRoot.value.trim() !== '') argv.push('--probe-root', probeRoot.value.trim());
    if (dryRun.value) argv.push('--dry-run');
    result.value = await props.run(argv);
  } finally {
    running.value = false;
  }
}

function openExperience(): void {
  const id = data.value?.experience_id;
  if (id !== null && id !== undefined) emit('open-experience', id);
}
</script>

<template>
  <section class="content" data-testid="pipeline-view">
    <p class="muted">{{ $t('pipeline.intro') }}</p>

    <div class="panel wide">
      <label>
        <span class="muted">{{ $t('pipeline.problem') }}</span>
        <textarea
          v-model="problem"
          data-testid="pipeline-problem"
          rows="3"
          :placeholder="$t('pipeline.problemPlaceholder')"
        />
      </label>
      <div class="row">
        <label>
          <span class="muted">{{ $t('pipeline.probeRoot') }}</span>
          <input
            v-model="probeRoot"
            data-testid="pipeline-probe-root"
            :placeholder="$t('pipeline.probeRootPlaceholder')"
          />
        </label>
        <label>
          <span class="muted">{{ $t('pipeline.outputDir') }}</span>
          <input
            v-model="outputDir"
            data-testid="pipeline-output-dir"
            :placeholder="effectiveOutputDir"
          />
        </label>
      </div>
      <p class="muted">{{ $t('pipeline.probeHint') }}</p>
      <label class="inline">
        <input v-model="dryRun" type="checkbox" data-testid="pipeline-dry-run" />
        <span class="muted">{{ $t('pipeline.dryRun') }}</span>
      </label>
      <button
        class="primary"
        data-testid="pipeline-run"
        :disabled="busy || running"
        @click="runNow"
      >
        {{ running ? $t('pipeline.running') : $t('pipeline.run') }}
      </button>
      <p v-if="message !== ''" class="bad" data-testid="pipeline-message">{{ message }}</p>
    </div>

    <div
      v-if="result !== null"
      class="panel wide"
      data-testid="pipeline-result"
      :data-result-ok="result.ok"
      :data-dry-run="data?.dry_run === true"
      :data-applied="data?.applied === true"
      :data-probed="data?.evidence.probed === true"
      :data-documents="data?.documents.length ?? 0"
      :data-experience-id="data?.experience_id ?? ''"
    >
      <h2>{{ $t('pipeline.resultTitle') }}</h2>
      <p v-if="!result.ok" class="bad" data-testid="pipeline-error">
        {{ $t('pipeline.failed', { code: result.exit_code }) }}
        <span v-if="findingsText !== ''">｜{{ findingsText }}</span>
      </p>

      <template v-if="data !== null">
        <p class="muted" data-testid="pipeline-summary">
          {{
            $t('pipeline.summary', {
              provider: data.provider,
              host: data.host,
              state: data.applied ? $t('pipeline.applied') : $t('pipeline.previewed'),
            })
          }}
        </p>
        <p class="muted">
          {{ $t('pipeline.outputDirLabel')
          }}<code data-testid="pipeline-output-path">{{ data.output_dir }}</code>
        </p>
        <p class="muted" data-testid="pipeline-adaptation">{{ adaptationText }}</p>

        <h3>{{ $t('pipeline.documents', { count: data.documents.length }) }}</h3>
        <ul v-if="data.documents.length > 0" class="documents" data-testid="pipeline-documents">
          <li v-for="doc in data.documents" :key="doc">
            <code>{{ doc }}</code>
          </li>
        </ul>
        <p v-else class="muted">{{ $t('pipeline.noDocuments') }}</p>

        <h3>{{ $t('pipeline.evidenceTitle') }}</h3>
        <div data-testid="pipeline-evidence">
          <template v-if="data.evidence.probed">
            <p class="muted">
              {{ $t('pipeline.evidenceProbed', { root: data.evidence.root ?? '' }) }}
            </p>
            <p v-if="data.evidence.stack.length > 0" class="muted">
              {{ $t('pipeline.evidenceStack', { stack: data.evidence.stack.join('、') }) }}
            </p>
            <h4>{{ $t('pipeline.suspects', { count: data.evidence.suspects.length }) }}</h4>
            <ul v-if="data.evidence.suspects.length > 0" class="suspects">
              <li v-for="item in data.evidence.suspects" :key="item">
                <code>{{ item }}</code>
              </li>
            </ul>
            <h4>{{ $t('pipeline.checks', { count: data.evidence.checks.length }) }}</h4>
            <ul v-if="data.evidence.checks.length > 0" class="suspects">
              <li v-for="item in data.evidence.checks" :key="item">
                <code>{{ item }}</code>
              </li>
            </ul>
            <h4>
              {{ $t('pipeline.relatedTests', { count: data.evidence.related_tests.length }) }}
            </h4>
            <ul v-if="data.evidence.related_tests.length > 0" class="suspects">
              <li v-for="item in data.evidence.related_tests" :key="item">
                <code>{{ item }}</code>
              </li>
            </ul>
          </template>
          <p v-else class="muted" data-testid="pipeline-not-probed">
            {{ $t('pipeline.evidenceNotProbed') }}
          </p>
          <template v-if="data.evidence.warnings.length > 0">
            <h4>{{ $t('pipeline.warnings', { count: data.evidence.warnings.length }) }}</h4>
            <ul class="warnings">
              <li v-for="item in data.evidence.warnings" :key="item">{{ item }}</li>
            </ul>
          </template>
        </div>

        <p class="muted" data-testid="pipeline-experience">
          {{
            data.experience_id === null
              ? $t('pipeline.experienceNotRecorded')
              : $t('pipeline.experienceRecorded', { id: data.experience_id })
          }}
        </p>
        <button
          v-if="data.experience_id !== null"
          data-testid="pipeline-open-experience"
          @click="openExperience"
        >
          {{ $t('pipeline.openExperience') }}
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
  padding: calc(var(--space) * 2);
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.inline {
  display: flex;
  align-items: center;
  gap: calc(var(--space) * 2);
  margin: calc(var(--space) * 2) 0;
}

.documents,
.suspects,
.warnings {
  margin: 0 0 calc(var(--space) * 2) 0;
  padding-left: calc(var(--space) * 5);
  font-size: 12px;
  word-break: break-all;
}

.warnings {
  color: var(--warning);
}
</style>
