/**
 * Stub for Nuxt's `#components` auto-import alias, which only exists inside a
 * running Nuxt instance. `app/utils/table.ts` imports `UButton` from it to
 * build a sortable-column header renderer; unit tests here only exercise the
 * pure sorting logic in that file, never call the renderer, but the module
 * still has to import *something* for `UButton` at load time. This stands in
 * for it — see vitest.config.ts's `#components` alias.
 */
export const UButton = 'button'
