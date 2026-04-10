<script setup lang="ts">
const { t, locale, setLocale } = useI18n()
const route = useRoute()

const { data: authMe, refresh: refreshAuth } = await useAsyncData(
  'auth-me',
  () =>
    $fetch<{ data: { user: { id: number; username: string } | null } }>('/api/auth/me'),
  {
    watch: [() => route.path],
  }
)

const authUser = computed(() => authMe.value?.data?.user ?? null)

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    /* ignore */
  }
  await refreshAuth()
  await navigateTo('/login')
}
</script>

<template>
  <div class="app-root">
    <NuxtRouteAnnouncer />
    <header class="app-header">
      <div class="app-header-inner">
        <NuxtLink to="/" class="brand">{{ t('nav.brand') }}</NuxtLink>
        <div class="app-header-actions">
          <nav v-if="authUser" class="app-nav" :aria-label="t('nav.ariaMain')">
            <NuxtLink to="/email-logs" class="nav-link">{{ t('nav.emailLogs') }}</NuxtLink>
            <NuxtLink to="/settings" class="nav-link">{{ t('nav.settings') }}</NuxtLink>
          </nav>
          <span v-if="authUser" class="nav-user" :title="authUser.username">{{ authUser.username }}</span>
          <button v-if="authUser" type="button" class="nav-logout" @click="logout">
            {{ t('nav.logout') }}
          </button>
          <div class="locale-switch" role="group" :aria-label="t('nav.localeGroup')">
            <button
              type="button"
              class="locale-btn"
              :class="{ 'locale-btn--active': locale === 'tr' }"
              @click="setLocale('tr')"
            >
              TR
            </button>
            <button
              type="button"
              class="locale-btn"
              :class="{ 'locale-btn--active': locale === 'en' }"
              @click="setLocale('en')"
            >
              EN
            </button>
          </div>
        </div>
      </div>
    </header>
    <main class="app-main">
      <NuxtPage />
    </main>
  </div>
</template>

<style>
/* Tema: uygulama geneli — alt sayfalar var(--app-*) ile tüketir */
html {
  box-sizing: border-box;
  height: 100%;
  overflow-x: clip;
}
*,
*::before,
*::after {
  box-sizing: inherit;
}
body {
  margin: 0;
  min-height: 100%;
  overflow-x: clip;
}

.app-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  min-height: 100vh;
  font-family: var(--app-font);
  color: var(--app-text);
  background: var(--app-bg);
  background-image: var(--app-bg-gradient);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;

  --app-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --app-font-mono: ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, monospace;
  --app-bg: #eef0f6;
  --app-bg-gradient: linear-gradient(160deg, #eef0f7 0%, #e9ecf4 50%, #e4e8f2 100%);
  --app-surface: #ffffff;
  --app-border: #d1d5e0;
  --app-border-subtle: #e6e8f0;
  --app-text: #0c1020;
  --app-text-secondary: #4b5160;
  --app-text-muted: #7a8194;
  --app-accent: #4338ca;
  --app-accent-hover: #3730a3;
  --app-accent-muted: #6366f1;
  --app-link: #4338ca;
  --app-link-hover: #312e81;
  --app-header-gradient: linear-gradient(
    165deg,
    #1e1b36 0%,
    #25244a 42%,
    #1a1930 100%
  );
  --app-header-text: #f3f4f8;
  --app-header-muted: #a8adbf;
  --app-radius-sm: 12px;
  --app-radius-md: 16px;
  --app-radius-lg: 20px;
  --app-radius-xl: 24px;
  --app-radius-pill: 999px;
  --app-shadow-sm: 0 2px 8px rgba(15, 23, 42, 0.04);
  --app-shadow-md: 0 8px 32px rgba(15, 23, 42, 0.06), 0 2px 8px rgba(15, 23, 42, 0.03);
  --app-shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  --app-success-bg: #ecfdf5;
  --app-success-border: #a7f3d0;
  --app-success-text: #065f46;
  --app-error-bg: #fef2f2;
  --app-error-border: #fecaca;
  --app-error-text: #991b1b;
  --app-warn-bg: #fffbeb;
  --app-warn-border: #fde68a;
}

.app-header {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 0.65rem clamp(1rem, 3vw, 1.5rem);
  color: var(--app-header-text);
  background: var(--app-header-gradient);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow:
    0 4px 24px rgba(15, 12, 35, 0.35),
    0 1px 0 rgba(129, 140, 248, 0.12) inset;
}

.app-header-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.25rem;
  width: 100%;
  max-width: min(1400px, 100%);
  margin: 0 auto;
}

.brand {
  color: inherit;
  font-weight: 700;
  font-size: 1.0625rem;
  letter-spacing: -0.025em;
  text-decoration: none;
  transition: opacity 0.2s ease;
}
.brand:hover {
  opacity: 0.92;
}

.app-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.locale-switch {
  display: flex;
  padding: 0.2rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.locale-btn {
  padding: 0.4rem 0.65rem;
  border: none;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  color: var(--app-header-muted);
  background: transparent;
  transition:
    color 0.2s ease,
    background 0.2s ease;
}

.locale-btn:hover {
  color: var(--app-header-text);
  background: rgba(255, 255, 255, 0.08);
}

.locale-btn--active {
  color: var(--app-header-text);
  background: rgba(99, 102, 241, 0.28);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.nav-link {
  padding: 0.5rem 1rem;
  border-radius: 999px;
  color: var(--app-header-muted);
  text-decoration: none;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}
.nav-link:hover {
  color: var(--app-header-text);
  background: rgba(255, 255, 255, 0.08);
}
.nav-link.router-link-active {
  color: var(--app-header-text);
  background: rgba(99, 102, 241, 0.28);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.nav-user {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-header-muted);
}

.nav-logout {
  padding: 0.45rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--app-header-text);
  background: rgba(0, 0, 0, 0.2);
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

.nav-logout:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.35);
}

.app-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: min(1400px, 100%);
  margin: 0 auto;
  padding: clamp(1rem, 2.5vw, 1.5rem) clamp(1rem, 2.5vw, 1.25rem) clamp(1.5rem, 4vw, 2.25rem);
  display: flex;
  flex-direction: column;
  overflow-x: clip;
  overflow-y: auto;
}

/* Sayfa kökü viewport içinde kalsın; tablo alanı gerektiğinde kendi içinde kayar */
.app-main > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
</style>
