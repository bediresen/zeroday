// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    defaultLocale: 'tr',
    locales: [
      { code: 'tr', language: 'tr-TR', name: 'Türkçe', file: 'tr.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    lazy: true,
    langDir: 'locales',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
  },
  /**
   * `app/` varken srcDir = `app/` olur; varsayılan sayfa dizini `app/pages`.
   * Sayfalar proje kökünde `pages/` altında tutuluyorsa burada açıkça gösterilmeli.
   */
  dir: {
    pages: '../pages',
  },
  pages: true,
  runtimeConfig: {
    /** Azure AI Translator — env: NUXT_AZURE_TRANSLATOR_KEY */
    azureTranslatorKey: process.env.AZURE_TRANSLATOR_KEY,
    /** Azure kaynak bölgesi (ör. westeurope) — env: NUXT_AZURE_TRANSLATOR_REGION; çok hizmetli anahtarlarda gerekli */
    azureTranslatorRegion: 'westeurope',
    nvdApiKey: '',
    cve: {
      dialect: 'mysql',
      url: '',
      host: '127.0.0.1',
      port: 3306,
      database: '',
      user: '',
      password: '',
    },

    minio: {
      endpoint: '',
      accessKey: '',
      secretKey: '',
      bucket: 'cve-reports',
      region: 'us-east-1',
    },
  },
})
