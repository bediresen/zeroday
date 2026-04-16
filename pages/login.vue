<script setup lang="ts">
const { t } = useI18n()
const config = useRuntimeConfig()

const showRegister = computed(() => Boolean(config.public.authAllowRegister))

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const busy = ref(false)
const errMsg = ref('')
const successMsg = ref('')

function readApiErrorMessage(err: unknown, fallback: string): string {
  const e = err as {
    data?: unknown
    message?: string
    statusMessage?: string
  }
  const d = e?.data as Record<string, unknown> | undefined
  if (d && typeof d === 'object') {
    if (typeof d.message === 'string' && d.message.trim()) return d.message.trim()
    const inner = d.data as Record<string, unknown> | undefined
    if (
      inner &&
      typeof inner === 'object' &&
      typeof inner.message === 'string' &&
      inner.message.trim()
    ) {
      return inner.message.trim()
    }
  }
  const msg = e?.message
  if (typeof msg === 'string' && msg.trim() && !/^\[\d+\]/.test(msg)) return msg.trim()
  if (typeof e?.statusMessage === 'string' && e.statusMessage.trim()) return e.statusMessage.trim()
  return fallback
}

function readApiStatusCode(err: unknown): number | undefined {
  const e = err as { statusCode?: number; status?: number }
  return e?.statusCode ?? e?.status
}

watch(mode, () => {
  errMsg.value = ''
  successMsg.value = ''
})

async function submit() {
  errMsg.value = ''
  successMsg.value = ''
  const u = username.value.trim()
  const p = password.value
  if (!u || !p) {
    errMsg.value = t('login.fillAll')
    return
  }
  busy.value = true
  try {
    if (mode.value === 'register') {
      await $fetch('/api/auth/register', {
        method: 'POST',
        body: { username: u, password: p },
      })
      password.value = ''
      mode.value = 'login'
      successMsg.value = t('login.registerSuccess')
      await refreshNuxtData('auth-me')
    } else {
      await $fetch('/api/auth/login', {
        method: 'POST',
        body: { username: u, password: p },
      })
      busy.value = false
      void refreshNuxtData('auth-me')
      await navigateTo('/')
    }
  } catch (e: unknown) {
    const code = readApiStatusCode(e)
    const apiMsg = readApiErrorMessage(e, '')
    if (code === 401 && mode.value === 'login') {
      errMsg.value = apiMsg || t('login.wrongCredentials')
    } else {
      errMsg.value = apiMsg || t('login.errorGeneric')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">{{ t('login.title') }}</h1>
      <p class="login-lead">{{ t('login.lead') }}</p>

      <div v-if="showRegister" class="mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ 'mode-tab--active': mode === 'login' }"
          :aria-selected="mode === 'login'"
          @click="mode = 'login'"
        >
          {{ t('login.tabLogin') }}
        </button>
        <button
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ 'mode-tab--active': mode === 'register' }"
          :aria-selected="mode === 'register'"
          @click="mode = 'register'"
        >
          {{ t('login.tabRegister') }}
        </button>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label class="field">
          <span class="field-label">{{ t('login.username') }}</span>
          <input
            v-model="username"
            type="text"
            name="username"
            autocomplete="username"
            class="field-input"
            maxlength="32"
          />
        </label>
        <label class="field">
          <span class="field-label">{{ t('login.password') }}</span>
          <input
            v-model="password"
            type="password"
            name="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            class="field-input"
          />
        </label>
        <p v-if="successMsg" class="banner banner--ok">{{ successMsg }}</p>
        <p v-if="errMsg" class="banner banner--err">{{ errMsg }}</p>
        <button type="submit" class="btn btn--primary btn--block" :disabled="busy">
          {{
            busy
              ? t('login.working')
              : mode === 'register'
                ? t('login.submitRegister')
                : t('login.submitLogin')
          }}
        </button>
      </form>

      <p v-if="!showRegister" class="hint muted">{{ t('login.registerClosed') }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: min(70vh, 560px);
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: 1.5rem clamp(1.25rem, 4vw, 1.75rem);
  background: var(--app-surface);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-md);
}

.login-title {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}

.login-lead {
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  color: var(--app-text-secondary);
  line-height: 1.45;
}

.mode-tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 1.25rem;
  padding: 0.25rem;
  border-radius: var(--app-radius-pill);
  background: var(--app-bg);
  border: 1px solid var(--app-border-subtle);
}

.mode-tab {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: var(--app-radius-pill);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--app-text-muted);
  background: transparent;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.mode-tab:hover {
  color: var(--app-text-secondary);
}

.mode-tab--active {
  color: var(--app-text);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}

.field-input {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  font-size: 0.9375rem;
  font-family: inherit;
  color: var(--app-text);
  background: #fafbfe;
  transition: border-color 0.15s ease;
}

.field-input:focus {
  outline: none;
  border-color: var(--app-accent-muted);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.banner {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: var(--app-radius-sm);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.banner--err {
  color: var(--app-error-text);
  background: var(--app-error-bg);
  border: 1px solid var(--app-error-border);
}

.banner--ok {
  color: #0d5c2f;
  background: #ecfdf3;
  border: 1px solid #86efac;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.65rem 1rem;
  border-radius: var(--app-radius-sm);
  font-size: 0.9375rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  border: none;
  transition:
    background 0.15s ease,
    opacity 0.15s ease;
}

.btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn--primary {
  color: #fff;
  background: var(--app-accent);
}

.btn--primary:hover:not(:disabled) {
  background: var(--app-accent-hover);
}

.btn--block {
  width: 100%;
}

.hint {
  margin: 1rem 0 0;
  font-size: 0.8125rem;
  text-align: center;
}

.muted {
  color: var(--app-text-muted);
}
</style>
