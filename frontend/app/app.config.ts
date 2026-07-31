export default defineAppConfig({
  // https://ui.nuxt.com/getting-started/theme#design-system
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'slate',
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
  }
})
