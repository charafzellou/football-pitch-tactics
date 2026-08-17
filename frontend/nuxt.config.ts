// https://nuxt.com/docs/api/configuration/nuxt-config
import { buildPrePaintScript } from "./app/utils/theme-definitions";

export default defineNuxtConfig({
    /**
     * SPA mode.
     *
     * Every route sits behind the active-save guard and fetches its own state
     * on mount, so server rendering produced an empty shell while actively
     * causing bugs: the lineup builder restores a saved XI from the API, which
     * the server could not know about, so its markup disagreed with the
     * client's on hydration. Vue does not rectify those mismatches, which left
     * buttons stuck in their server-rendered disabled state.
     *
     * There is no SEO surface to lose — it is a local single-player game.
     */
    ssr: false,

    app: {
        // Nuxt UI gates its dark rules on `.dark` (`@variant dark (&:where(.dark, .dark *))`).
        // The app is dark-only, so the class is fixed here rather than toggled —
        // themes vary the palette inside that frame, not the light/dark mode.
        head: {
            htmlAttrs: { class: "dark", lang: "en" },
            title: "Football Pitch Tactics",
            meta: [
                { name: "viewport", content: "width=device-width, initial-scale=1" },
                { name: "description", content: "Create and share football pitch tactics easily." },
                { name: "theme-color", content: "#161f2c" },
            ],
            // Applies the saved palette to <html> before the first paint. It has
            // to live in the shell rather than in a plugin: in SPA mode a plugin
            // only runs once the bundle has loaded, by which point the default
            // theme has already been painted.
            script: [{ innerHTML: buildPrePaintScript(), tagPosition: "head" }],
        },
        pageTransition: { name: "page-fade", mode: "out-in" },
        layoutTransition: { name: "page-fade", mode: "out-in" },
    },
    modules: ["@nuxt/ui", "@pinia/nuxt", "@vueuse/nuxt"],
    css: ["@/assets/css/main.css"],
    devtools: { enabled: false },
    compatibilityDate: '2025-08-07',
});
