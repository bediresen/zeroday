<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <NvdCveFeedTable
    fetch-path="/api/v2/cves/nvd"
    fetch-key="nvd-publication-window"
    :title="t('pages.home.title')"
    :lead="t('pages.home.lead')"
    :show-db-meta="true"
    show-pdf-report
  />
</template>
