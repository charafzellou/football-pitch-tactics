/**
 * Loads saved preferences into the store and keeps <html> in sync with them.
 *
 * The *first* application of the theme happens earlier, in the inline snippet
 * `nuxt.config.ts` puts in the document head — this plugin only takes over
 * once the bundle is running, so later changes (a theme switch, an edited
 * accent) reach the document too.
 */
export default defineNuxtPlugin({
  name: 'theme',
  setup() {
    const settings = useSettingsStore()
    settings.load()
    settings.applyTheme()
  },
})
