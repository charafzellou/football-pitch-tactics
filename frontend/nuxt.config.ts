// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    app: {
        head: {
            title: "Football Pitch Tactics",
            meta: [
                { name: "viewport", content: "width=device-width, initial-scale=1" },
                { name: "description", content: "Create and share football pitch tactics easily." },
                { name: "theme-color", content: "#ffffff" },
            ],
        },
    },
    modules: ["@nuxt/ui", "@pinia/nuxt"],
    css: ["@/assets/css/main.css"],
    devtools: { enabled: false },
    compatibilityDate: '2025-08-07',
});
