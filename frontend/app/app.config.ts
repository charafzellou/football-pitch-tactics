export default defineAppConfig({
  // https://ui.nuxt.com/getting-started/theme#design-system
  ui: {
    colors: {
      // Both point at ramps we declare ourselves in `main.css` rather than at
      // stock Tailwind palettes. That is what makes runtime theming possible:
      // Nuxt UI resolves `--ui-color-primary-500` to `var(--color-brand-500)`,
      // and `utils/themes.ts` rewrites that variable on <html>.
      primary: 'brand',
      neutral: 'shell',
    },
    card: {
      slots: {
        root: 'app-card-root',
        header: 'app-card-header',
        body: 'app-card-body',
        footer: 'app-card-footer',
      },
      defaultVariants: {
        variant: 'subtle',
      },
    },
    button: {
      defaultVariants: {
        color: 'primary',
        variant: 'solid',
      },
    },
    badge: {
      defaultVariants: {
        color: 'primary',
        variant: 'soft',
      },
    },
    input: {
      defaultVariants: {
        color: 'primary',
        variant: 'outline',
      },
    },
    selectMenu: {
      defaultVariants: {
        color: 'primary',
        variant: 'outline',
      },
    },
    modal: {
      slots: {
        overlay: 'backdrop-blur-sm',
        content: 'app-surface',
      },
    },
    tooltip: {
      slots: {
        content: 'app-glass px-2 py-1 text-xs',
      },
    },
    table: {
      slots: {
        th: 'app-kicker text-left',
      },
    },
  },
})
