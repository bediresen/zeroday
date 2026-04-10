<script setup lang="ts">
const { t } = useI18n()

type SmtpPayload = {
  from: string
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  rejectUnauthorized: boolean
  passwordConfigured: boolean
}

type CronPayload = {
  timeZone: string
  hour: number
  minute: number
  daysOfWeek: number[]
  enabled: boolean
}

type EmailPayload = {
  recipientEmails: string[]
}

const tab = ref<'smtp' | 'cron' | 'email'>('smtp')
const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')

const smtp = ref<SmtpPayload>({
  from: '',
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  rejectUnauthorized: true,
  passwordConfigured: false,
})

const cron = ref<CronPayload>({
  timeZone: 'Europe/Istanbul',
  hour: 9,
  minute: 0,
  daysOfWeek: [],
  enabled: true,
})

/** Virgülle ayrılmış, chip olarak gösterilen adresler */
const recipientChips = ref<string[]>([])
/** Chip’lere eklenmemiş, yazılmakta olan son parça */
const recipientInput = ref('')
const recipientField = ref<HTMLInputElement | null>(null)

const { data, refresh, pending, error } = await useFetch<{
  data: { smtp: SmtpPayload; cron: CronPayload; email: EmailPayload }
}>('/api/v2/cve-settings', { key: 'cve-settings' })

watch(
  data,
  (d) => {
    if (!d?.data) return
    smtp.value = { ...d.data.smtp }
    cron.value = { ...d.data.cron, daysOfWeek: [...(d.data.cron.daysOfWeek || [])] }
    recipientChips.value = [...(d.data.email?.recipientEmails || [])]
    recipientInput.value = ''
  },
  { immediate: true }
)

const dayLabels = computed(() => [
  t('settings.cron.sun'),
  t('settings.cron.mon'),
  t('settings.cron.tue'),
  t('settings.cron.wed'),
  t('settings.cron.thu'),
  t('settings.cron.fri'),
  t('settings.cron.sat'),
])

function toggleDay(d: number) {
  const set = new Set(cron.value.daysOfWeek)
  if (set.has(d)) set.delete(d)
  else set.add(d)
  cron.value.daysOfWeek = [...set].sort((a, b) => a - b)
}

function flushCommasFromInput() {
  let v = recipientInput.value
  while (v.includes(',')) {
    const i = v.indexOf(',')
    const seg = v.slice(0, i).trim()
    if (seg) recipientChips.value.push(seg)
    v = v.slice(i + 1).trimStart()
  }
  recipientInput.value = v
}

function removeRecipientChip(index: number) {
  recipientChips.value.splice(index, 1)
}

function commitRecipientDraft() {
  const t = recipientInput.value.trim()
  if (!t) return
  recipientChips.value.push(t)
  recipientInput.value = ''
}

function allRecipientsForSave(): string[] {
  const tail = recipientInput.value.trim()
  const list = [...recipientChips.value]
  if (tail) list.push(tail)
  return list.map((s) => s.trim()).filter((s) => s.includes('@'))
}

async function saveSmtp() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await $fetch('/api/v2/cve-settings', {
      method: 'PUT',
      body: {
        type: 'smtp',
        data: {
          from: smtp.value.from,
          host: smtp.value.host,
          port: Number(smtp.value.port),
          secure: smtp.value.secure,
          username: smtp.value.username,
          password: smtp.value.password,
          rejectUnauthorized: smtp.value.rejectUnauthorized,
        },
      },
    })
    saveMsg.value = t('settings.saved')
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    saveErr.value = err?.data?.message || err?.message || t('settings.saveFailed')
  } finally {
    saving.value = false
  }
}

async function saveCron() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await $fetch('/api/v2/cve-settings', {
      method: 'PUT',
      body: {
        type: 'cron',
        data: {
          timeZone: cron.value.timeZone,
          hour: Number(cron.value.hour),
          minute: Number(cron.value.minute),
          daysOfWeek: cron.value.daysOfWeek,
          enabled: cron.value.enabled,
        },
      },
    })
    saveMsg.value = t('settings.savedCron')
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    saveErr.value = err?.data?.message || err?.message || t('settings.saveFailed')
  } finally {
    saving.value = false
  }
}

async function saveEmail() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    const emails = allRecipientsForSave()
    await $fetch('/api/v2/cve-settings', {
      method: 'PUT',
      body: {
        type: 'email',
        data: {
          recipientEmails: emails,
        },
      },
    })
    saveMsg.value = t('settings.savedEmail')
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    saveErr.value = err?.data?.message || err?.message || t('settings.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <header class="head">
      <h1>{{ t('settings.title') }}</h1>
      <p class="lead">{{ t('settings.lead') }}</p>
    </header>

    <p v-if="error" class="banner banner--err">{{ error.message }}</p>
    <p v-if="pending" class="muted">{{ t('settings.loading') }}</p>

    <template v-else>
      <div class="tabs" role="tablist">
        <button
          type="button"
          class="tab"
          :class="{ 'tab--active': tab === 'smtp' }"
          role="tab"
          :aria-selected="tab === 'smtp'"
          @click="tab = 'smtp'"
        >
          {{ t('settings.tabSmtp') }}
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab--active': tab === 'cron' }"
          role="tab"
          :aria-selected="tab === 'cron'"
          @click="tab = 'cron'"
        >
          {{ t('settings.tabCron') }}
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab--active': tab === 'email' }"
          role="tab"
          :aria-selected="tab === 'email'"
          @click="tab = 'email'"
        >
          {{ t('settings.tabEmail') }}
        </button>
      </div>

      <p v-if="saveMsg" class="banner banner--ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="banner banner--err">{{ saveErr }}</p>

      <section v-show="tab === 'smtp'" class="panel">
        <h2>{{ t('settings.smtpTitle') }}</h2>
        <div class="grid">
          <label class="field">
            <span>{{ t('settings.from') }}</span>
            <input v-model="smtp.from" type="text" autocomplete="off" :placeholder="t('settings.fromPh')" />
          </label>
          <label class="field">
            <span>{{ t('settings.host') }}</span>
            <input v-model="smtp.host" type="text" autocomplete="off" :placeholder="t('settings.hostPh')" />
          </label>
          <label class="field field--sm">
            <span>{{ t('settings.port') }}</span>
            <input v-model.number="smtp.port" type="number" min="1" max="65535" />
          </label>
          <label class="field check">
            <input v-model="smtp.secure" type="checkbox" />
            <span>{{ t('settings.secure') }}</span>
          </label>
          <label class="field">
            <span>{{ t('settings.username') }}</span>
            <input v-model="smtp.username" type="text" autocomplete="username" />
          </label>
          <label class="field">
            <span>{{ t('settings.password') }}</span>
            <input
              v-model="smtp.password"
              type="password"
              autocomplete="new-password"
              :placeholder="smtp.passwordConfigured ? t('settings.passwordKeep') : ''"
            />
          </label>
          <label class="field check">
            <input v-model="smtp.rejectUnauthorized" type="checkbox" />
            <span>{{ t('settings.rejectUnauthorized') }}</span>
          </label>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--primary" :disabled="saving" @click="saveSmtp">
            {{ saving ? t('settings.saving') : t('settings.save') }}
          </button>
        </div>
      </section>

      <section v-show="tab === 'cron'" class="panel">
        <h2>{{ t('settings.cronTitle') }}</h2>
        <p class="hint">{{ t('settings.cronHint') }}</p>
        <p class="hint hint--sub">{{ t('settings.cronEmailNote') }}</p>
        <div class="grid">
          <label class="field check">
            <input v-model="cron.enabled" type="checkbox" />
            <span>{{ t('settings.cronEnabled') }}</span>
          </label>
          <label class="field">
            <span>{{ t('settings.timeZone') }}</span>
            <select v-model="cron.timeZone">
              <option value="Europe/Istanbul">Europe/Istanbul</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </label>
          <label class="field field--xs">
            <span>{{ t('settings.hour') }}</span>
            <input v-model.number="cron.hour" type="number" min="0" max="23" />
          </label>
          <label class="field field--xs">
            <span>{{ t('settings.minute') }}</span>
            <input v-model.number="cron.minute" type="number" min="0" max="59" />
          </label>
        </div>
        <div class="days">
          <span class="days-label">{{ t('settings.daysOfWeek') }}</span>
          <div class="day-chips">
            <button
              v-for="(label, d) in dayLabels"
              :key="d"
              type="button"
              class="day-chip"
              :class="{ 'day-chip--on': cron.daysOfWeek.includes(d) }"
              @click="toggleDay(d)"
            >
              {{ label }}
            </button>
          </div>
          <p class="muted tiny">{{ t('settings.daysEmptyHint') }}</p>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--primary" :disabled="saving" @click="saveCron">
            {{ saving ? t('settings.saving') : t('settings.saveCron') }}
          </button>
        </div>
      </section>

      <section v-show="tab === 'email'" class="panel">
        <h2>{{ t('settings.emailTitle') }}</h2>
        <p class="hint">{{ t('settings.emailHint') }}</p>
        <div class="field field--recipients">
          <span>{{ t('settings.recipients') }}</span>
          <p class="muted tiny recipient-hint">{{ t('settings.recipientsCommaHint') }}</p>
          <div class="recipient-shell" @click="recipientField?.focus()">
            <div class="recipient-chips">
              <span
                v-for="(addr, i) in recipientChips"
                :key="`${i}-${addr}`"
                class="recipient-chip"
                :title="addr"
              >
                <span class="recipient-chip-text">{{ addr }}</span>
                <button
                  type="button"
                  class="recipient-chip-remove"
                  :aria-label="t('settings.removeRecipient')"
                  @click.stop="removeRecipientChip(i)"
                >
                  ×
                </button>
              </span>
            </div>
            <input
              ref="recipientField"
              v-model="recipientInput"
              type="text"
              class="recipient-input"
              autocomplete="off"
              :placeholder="t('settings.recipientsPh')"
              @input="flushCommasFromInput"
              @keydown.enter.prevent="commitRecipientDraft"
            />
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--primary" :disabled="saving" @click="saveEmail">
            {{ saving ? t('settings.saving') : t('settings.saveEmail') }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 720px;
  margin: 0 auto;
}

.head {
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.375rem, 2.5vw, 1.75rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--app-text);
}

.lead {
  margin: 0;
  color: var(--app-text-secondary);
  line-height: 1.6;
  font-size: 0.9375rem;
}

.muted {
  color: var(--app-text-muted);
}

.tiny {
  font-size: 0.75rem;
  margin: 0.35rem 0 0;
}

.tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 1rem;
  padding: 0.25rem;
  border-radius: var(--app-radius-lg);
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.tab {
  flex: 1;
  padding: 0.55rem 0.85rem;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--app-text-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.tab--active {
  background: var(--app-surface);
  color: var(--app-text);
  box-shadow: var(--app-shadow-sm);
}

.panel {
  background: var(--app-surface);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: var(--app-radius-xl);
  padding: 1.35rem 1.45rem;
  margin-bottom: 1rem;
  box-shadow: var(--app-shadow-md);
}

.panel h2 {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--app-text);
}

.hint {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--app-text-secondary);
  line-height: 1.55;
}

.hint--sub {
  margin-top: -0.5rem;
  font-size: 0.8125rem;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem 1.25rem;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field span {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field input,
.field select,
.field textarea {
  padding: 0.55rem 0.75rem;
  border-radius: var(--app-radius-md);
  border: 1px solid rgba(148, 163, 184, 0.35);
  font-size: 0.9rem;
  font-family: inherit;
  background: #fafbfe;
}

.field textarea {
  resize: vertical;
  min-height: 5rem;
}

.field--recipients {
  grid-column: 1 / -1;
}

.recipient-hint {
  margin: 0 0 0.5rem;
}

.recipient-shell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.85rem;
  padding: 0.45rem 0.55rem;
  border-radius: var(--app-radius-md);
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: #fafbfe;
  cursor: text;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.recipient-shell:focus-within {
  border-color: rgba(99, 102, 241, 0.45);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.recipient-chips {
  display: contents;
}

.recipient-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: min(100%, 18rem);
  padding: 0.28rem 0.35rem 0.28rem 0.65rem;
  border-radius: var(--app-radius-pill, 999px);
  background: #fff;
  border: 1px solid rgba(99, 102, 241, 0.22);
  box-shadow:
    0 2px 10px rgba(15, 23, 42, 0.07),
    0 1px 2px rgba(15, 23, 42, 0.04);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--app-text);
  animation: chip-in 0.18s ease;
}

@keyframes chip-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.recipient-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recipient-chip-remove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  padding: 0;
  border: none;
  border-radius: var(--app-radius-pill, 999px);
  background: rgba(148, 163, 184, 0.18);
  color: var(--app-text-secondary);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.recipient-chip-remove:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #b91c1c;
}

.recipient-input {
  flex: 1;
  min-width: 10rem;
  border: none;
  background: transparent;
  padding: 0.35rem 0.3rem;
  font-size: 0.9rem;
  font-family: inherit;
  color: var(--app-text);
  outline: none;
}

.field--sm {
  max-width: 8rem;
}

.field--xs {
  max-width: 6rem;
}

.field.check {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.field.check span {
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.days {
  margin: 1rem 0;
}

.days-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.day-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.day-chip {
  padding: 0.35rem 0.65rem;
  border-radius: var(--app-radius-pill, 999px);
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: var(--app-surface);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--app-text-secondary);
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.day-chip--on {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.45);
  color: var(--app-accent);
}

.actions {
  margin-top: 1.25rem;
}

.btn {
  padding: 0.55rem 1.25rem;
  border-radius: var(--app-radius-md);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn--primary {
  background: linear-gradient(175deg, #5b52eb 0%, var(--app-accent) 55%, var(--app-accent-hover) 100%);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.banner {
  padding: 0.75rem 1rem;
  border-radius: var(--app-radius-md);
  font-size: 0.875rem;
  margin-bottom: 0.75rem;
}

.banner--ok {
  background: var(--app-success-bg);
  color: var(--app-success-text);
  border: 1px solid var(--app-success-border);
}

.banner--err {
  background: var(--app-error-bg);
  color: var(--app-error-text);
  border: 1px solid var(--app-error-border);
}
</style>
