/**
 * Theme data and the pre-paint snippet.
 *
 * Deliberately free of runtime dependencies (no colord) so `nuxt.config.ts`
 * can import `buildPrePaintScript()` and bake it into the HTML shell's <head>.
 * The app runs as an SPA, so a script added later via `useHead` would only
 * execute after the bundle loads — long after the first paint — and every
 * reload would flash the default palette.
 *
 * Colour maths that needs a library lives in `themes.ts`, which re-exports
 * everything here.
 */

export type ThemeId = 'premium' | 'cyberfoot' | 'classic'

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
export type Shade = (typeof SHADES)[number]

/**
 * Target HSL lightness per shade, tuned to sit close to Tailwind's own ramps
 * so a generated palette drops in beside the stock ones without looking off.
 */
export const SHADE_LIGHTNESS: Record<Shade, number> = {
  50: 96, 100: 91, 200: 82, 300: 71, 400: 60,
  500: 50, 600: 42, 700: 34, 800: 27, 900: 21, 950: 13,
}

/** The colours the Settings page exposes, and what each one drives. */
export const EDITABLE_SEEDS = [
  { key: 'brand', label: 'Accent', hint: 'Buttons, links and every primary control.' },
  { key: 'shell', label: 'Shell', hint: 'Page background, cards, borders and text tones.' },
  { key: 'pitch', label: 'Pitch', hint: 'The playing surface on the lineup builder.' },
  { key: 'gold', label: 'Gold', hint: 'Trophies, league position and premium accents.' },
  { key: 'gk', label: 'Goalkeeper', hint: 'Position badge colour for goalkeepers.' },
  { key: 'df', label: 'Defender', hint: 'Position badge colour for defenders.' },
  { key: 'mf', label: 'Midfielder', hint: 'Position badge colour for midfielders.' },
  { key: 'fw', label: 'Forward', hint: 'Position badge colour for forwards.' },
] as const

export type SeedKey = (typeof EDITABLE_SEEDS)[number]['key']
export type Seeds = Record<SeedKey, string>

/** Seeds that expand into a full 50–950 ramp rather than a single token. */
export const RAMP_SEEDS = ['brand', 'shell'] as const

/** Seeds written straight through as a single custom property. */
export const DIRECT_SEED_TOKENS: Record<Exclude<SeedKey, 'brand' | 'shell'>, string> = {
  pitch: '--app-seed-pitch',
  gold: '--app-seed-gold',
  gk: '--app-pos-gk',
  df: '--app-pos-df',
  mf: '--app-pos-mf',
  fw: '--app-pos-fw',
}

export interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
  /** Editable base colours. Every ramp and derived token comes from these. */
  seeds: Seeds
  /** Non-colour character: corner radius, border weight, texture, blur. */
  chrome: Record<string, string>
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  premium: {
    id: 'premium',
    label: 'Premium',
    description: 'Deep navy, emerald accent, gold for silverware. Editorial and modern.',
    seeds: {
      brand: '#00c16a',
      shell: '#3d5f92',
      pitch: '#0f8f63',
      gold: '#d4af37',
      gk: '#38bdf8',
      df: '#34d399',
      mf: '#fbbf24',
      fw: '#fb7185',
    },
    chrome: {
      '--ui-radius': '0.5rem',
      '--app-border-width': '1px',
      '--app-noise-opacity': '0.035',
      '--app-glass-blur': '16px',
      '--app-shadow-strength': '0.7',
      '--app-kicker-tracking': '0.2em',
      '--app-pitch-stripe': '0.05',
    },
  },

  cyberfoot: {
    id: 'cyberfoot',
    label: 'CyberFoot Retro',
    description: 'Saturated turf, amber chrome, hard square corners. The 2007 feel.',
    seeds: {
      brand: '#f59e0b',
      shell: '#4c6b52',
      pitch: '#1a9c3f',
      gold: '#ffd700',
      gk: '#22d3ee',
      df: '#4ade80',
      mf: '#facc15',
      fw: '#f97316',
    },
    chrome: {
      '--ui-radius': '0.125rem',
      '--app-border-width': '2px',
      '--app-noise-opacity': '0.08',
      '--app-glass-blur': '0px',
      '--app-shadow-strength': '1',
      '--app-kicker-tracking': '0.14em',
      '--app-pitch-stripe': '0.12',
    },
  },

  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'The original emerald and slate palette, preserved.',
    seeds: {
      brand: '#00c16a',
      shell: '#64748b',
      pitch: '#0d6048',
      gold: '#f59e0b',
      gk: '#38bdf8',
      df: '#34d399',
      mf: '#fbbf24',
      fw: '#fb7185',
    },
    chrome: {
      '--ui-radius': '0.75rem',
      '--app-border-width': '1px',
      '--app-noise-opacity': '0',
      '--app-glass-blur': '12px',
      '--app-shadow-strength': '0.6',
      '--app-kicker-tracking': '0.2em',
      '--app-pitch-stripe': '0',
    },
  },
}

export const THEME_LIST = Object.values(THEMES)
export const DEFAULT_THEME_ID: ThemeId = 'premium'
export const SETTINGS_STORAGE_KEY = 'fpt:settings:v1'

/**
 * The synchronous snippet inlined into <head>. Reads the saved palette from
 * localStorage and writes it onto <html> before the first paint.
 *
 * Re-implements the HSL ramp maths in a few lines rather than pulling a colour
 * library into the critical path.
 */
export function buildPrePaintScript(): string {
  const lightness = JSON.stringify(SHADE_LIGHTNESS)
  const direct = JSON.stringify(DIRECT_SEED_TOKENS)
  const themes = JSON.stringify(
    Object.fromEntries(THEME_LIST.map(theme => [theme.id, { seeds: theme.seeds, chrome: theme.chrome }])),
  )

  return `(function(){try{
var L=${lightness},D=${direct},T=${themes},KEY=${JSON.stringify(SETTINGS_STORAGE_KEY)};
var root=document.documentElement;
var saved={};try{saved=JSON.parse(localStorage.getItem(KEY))||{}}catch(e){}
var theme=T[saved.themeId]||T[${JSON.stringify(DEFAULT_THEME_ID)}];
var seeds=Object.assign({},theme.seeds,saved.seeds||{});
for(var c in theme.chrome)root.style.setProperty(c,theme.chrome[c]);
function toHsl(x){x=String(x||'').replace('#','');if(x.length===3)x=x[0]+x[0]+x[1]+x[1]+x[2]+x[2];
if(!/^[0-9a-f]{6}$/i.test(x))return null;
var r=parseInt(x.slice(0,2),16)/255,g=parseInt(x.slice(2,4),16)/255,b=parseInt(x.slice(4,6),16)/255;
var mx=Math.max(r,g,b),mn=Math.min(r,g,b),h=0,s=0,l=(mx+mn)/2,d=mx-mn;
if(d){s=l>0.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4);h*=60}
return[h,s*100,l*100]}
function toHex(h,s,l){s/=100;l/=100;var c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(((h%360)/60)%2-1)),m=l-c/2;
var p=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(((h%360)+360)%360/60)];
return'#'+p.map(function(v){return Math.round((v+m)*255).toString(16).padStart(2,'0')}).join('')}
['brand','shell'].forEach(function(n){var c=toHsl(seeds[n]);if(!c)return;
for(var sh in L){var l=L[sh],damp=l>85?0.7:l<20?0.82:1;
root.style.setProperty('--color-'+n+'-'+sh,toHex(c[0],Math.min(100,c[1]*damp),l))}});
for(var k in D){if(seeds[k])root.style.setProperty(D[k],seeds[k])}
if(saved.motion&&saved.motion!=='full')root.setAttribute('data-motion',saved.motion);
}catch(e){}})();`
}
