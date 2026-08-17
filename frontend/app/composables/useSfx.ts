/**
 * Match and interface sound, synthesised with the Web Audio API.
 *
 * Deliberately asset-free: eight short cues generated from oscillators and
 * filtered noise cost nothing to ship, need no licensing and work offline.
 * A real recording can be substituted per cue without touching this file —
 * list it in `public/sfx/manifest.json` and it takes precedence over the
 * synthesised version (see `loadManifest`).
 *
 * The AudioContext is created on the first cue rather than up front, because
 * browsers refuse to start one outside a user gesture and a suspended context
 * logs a warning on every page load.
 */
import { useSettingsStore } from '~/stores/settings'
import type { SfxCategory } from '~/stores/settings'

export type SfxName =
  | 'click'
  | 'select'
  | 'deselect'
  | 'error'
  | 'success'
  | 'whistle'
  | 'whistleLong'
  | 'goal'
  | 'goalAgainst'
  | 'card'
  | 'sub'
  | 'tick'

const CATEGORY: Record<SfxName, SfxCategory> = {
  click: 'ui',
  select: 'ui',
  deselect: 'ui',
  error: 'ui',
  success: 'ui',
  tick: 'ui',
  card: 'ui',
  sub: 'ui',
  whistle: 'whistle',
  whistleLong: 'whistle',
  goal: 'crowd',
  goalAgainst: 'crowd',
}

let context: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let samples: Record<string, AudioBuffer> = {}
let manifestLoaded = false

function ensureContext(): AudioContext | null {
  if (!import.meta.client) return null

  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    context = new Ctor()
    master = context.createGain()
    master.connect(context.destination)
  }

  // Autoplay policy parks the context until a gesture; every cue is triggered
  // by one, so resuming here is safe and cheap.
  if (context.state === 'suspended')
    void context.resume()

  return context
}

/** Cached white-noise buffer — the basis for crowd, whistle breath and thuds. */
function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer

  const length = ctx.sampleRate * 2
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < length; i++)
    data[i] = Math.random() * 2 - 1

  return noiseBuffer
}

interface ToneOptions {
  freq: number
  /** Optional glide target, for whistles and swoops. */
  to?: number
  type?: OscillatorType
  start?: number
  duration?: number
  gain?: number
  attack?: number
}

function tone(ctx: AudioContext, out: GainNode, options: ToneOptions) {
  const { freq, to, type = 'sine', start = 0, duration = 0.2, gain = 0.3, attack = 0.008 } = options
  const t0 = ctx.currentTime + start

  const osc = ctx.createOscillator()
  const env = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration)

  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

  osc.connect(env)
  env.connect(out)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

interface NoiseOptions {
  start?: number
  duration?: number
  gain?: number
  /** Band-pass centre. Low for rumble, high for hiss. */
  frequency?: number
  q?: number
  /** Ramp the filter to this frequency across the sound. */
  frequencyTo?: number
  type?: BiquadFilterType
  /** Fraction of the duration spent rising before the fall. */
  swell?: number
}

function noise(ctx: AudioContext, out: GainNode, options: NoiseOptions = {}) {
  const {
    start = 0, duration = 0.3, gain = 0.2,
    frequency = 1000, frequencyTo, q = 1, type = 'bandpass', swell = 0.1,
  } = options
  const t0 = ctx.currentTime + start

  const source = ctx.createBufferSource()
  source.buffer = getNoise(ctx)
  source.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.setValueAtTime(frequency, t0)
  filter.Q.value = q
  if (frequencyTo !== undefined)
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, frequencyTo), t0 + duration)

  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + duration * swell)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

  source.connect(filter)
  filter.connect(env)
  env.connect(out)
  source.start(t0)
  source.stop(t0 + duration + 0.02)
}

/** The synthesised cue definitions. */
const SYNTH: Record<SfxName, (ctx: AudioContext, out: GainNode) => void> = {
  click: (ctx, out) => {
    tone(ctx, out, { freq: 620, to: 480, type: 'triangle', duration: 0.05, gain: 0.16 })
  },

  select: (ctx, out) => {
    tone(ctx, out, { freq: 520, type: 'sine', duration: 0.08, gain: 0.18 })
    tone(ctx, out, { freq: 780, type: 'sine', start: 0.05, duration: 0.1, gain: 0.14 })
  },

  deselect: (ctx, out) => {
    tone(ctx, out, { freq: 420, to: 260, type: 'sine', duration: 0.12, gain: 0.14 })
  },

  error: (ctx, out) => {
    tone(ctx, out, { freq: 180, to: 90, type: 'square', duration: 0.18, gain: 0.12 })
    noise(ctx, out, { duration: 0.14, gain: 0.08, frequency: 220, q: 0.7 })
  },

  success: (ctx, out) => {
    tone(ctx, out, { freq: 523, type: 'sine', duration: 0.1, gain: 0.16 })
    tone(ctx, out, { freq: 659, type: 'sine', start: 0.07, duration: 0.1, gain: 0.15 })
    tone(ctx, out, { freq: 784, type: 'sine', start: 0.14, duration: 0.18, gain: 0.14 })
  },

  // A referee's pea whistle: two close tones beating against each other, with
  // breath noise on top. The slight detune is what stops it sounding like a
  // test signal.
  whistle: (ctx, out) => {
    tone(ctx, out, { freq: 2400, type: 'sine', duration: 0.22, gain: 0.1, attack: 0.012 })
    tone(ctx, out, { freq: 2470, type: 'sine', duration: 0.22, gain: 0.08, attack: 0.012 })
    noise(ctx, out, { duration: 0.22, gain: 0.05, frequency: 2600, q: 6 })
  },

  whistleLong: (ctx, out) => {
    for (const start of [0, 0.26, 0.52]) {
      const duration = start === 0.52 ? 0.5 : 0.18
      tone(ctx, out, { freq: 2400, type: 'sine', start, duration, gain: 0.1, attack: 0.012 })
      tone(ctx, out, { freq: 2470, type: 'sine', start, duration, gain: 0.08, attack: 0.012 })
      noise(ctx, out, { start, duration, gain: 0.04, frequency: 2600, q: 6 })
    }
  },

  // Crowd roar: a broad low-mid noise swell with a slow filter sweep upward,
  // plus a bright layer for the initial gasp.
  goal: (ctx, out) => {
    noise(ctx, out, { duration: 1.8, gain: 0.26, frequency: 320, frequencyTo: 1400, q: 0.6, swell: 0.18 })
    noise(ctx, out, { start: 0.04, duration: 1.2, gain: 0.12, frequency: 2200, q: 0.8, swell: 0.1 })
    tone(ctx, out, { freq: 320, to: 520, type: 'sawtooth', duration: 0.5, gain: 0.05 })
  },

  goalAgainst: (ctx, out) => {
    noise(ctx, out, { duration: 1.2, gain: 0.14, frequency: 260, frequencyTo: 160, q: 0.6, swell: 0.25 })
    tone(ctx, out, { freq: 220, to: 130, type: 'sine', duration: 0.7, gain: 0.08 })
  },

  card: (ctx, out) => {
    noise(ctx, out, { duration: 0.06, gain: 0.14, frequency: 3200, q: 3 })
    tone(ctx, out, { freq: 900, to: 700, type: 'triangle', duration: 0.07, gain: 0.1 })
  },

  sub: (ctx, out) => {
    tone(ctx, out, { freq: 380, to: 760, type: 'sine', duration: 0.16, gain: 0.13 })
    noise(ctx, out, { duration: 0.2, gain: 0.05, frequency: 900, frequencyTo: 2200, q: 1.2 })
  },

  tick: (ctx, out) => {
    tone(ctx, out, { freq: 1200, type: 'square', duration: 0.02, gain: 0.05 })
  },
}

/**
 * Looks for real recordings once per session. The manifest always exists (an
 * empty list by default), so this never produces a 404 in the console.
 */
async function loadManifest(ctx: AudioContext) {
  if (manifestLoaded) return
  manifestLoaded = true

  try {
    const manifest = await $fetch<{ samples?: string[] }>('/sfx/manifest.json')
    const names = manifest?.samples ?? []

    await Promise.all(names.map(async (name) => {
      try {
        const data = await $fetch<ArrayBuffer>(`/sfx/${name}.mp3`, { responseType: 'arrayBuffer' })
        samples[name] = await ctx.decodeAudioData(data)
      }
      catch {
        // A listed-but-missing or undecodable file just falls back to synth.
      }
    }))
  }
  catch {
    // No manifest, no samples. Synthesis covers everything.
  }
}

export function useSfx() {
  const settings = useSettingsStore()

  function play(name: SfxName) {
    if (!import.meta.client) return
    if (settings.muted || settings.volume <= 0) return
    if (!settings.sfxCategories[CATEGORY[name]]) return

    const ctx = ensureContext()
    if (!ctx || !master) return

    master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.01)
    void loadManifest(ctx)

    const sample = samples[name]
    if (sample) {
      const source = ctx.createBufferSource()
      source.buffer = sample
      source.connect(master)
      source.start()
      return
    }

    SYNTH[name]?.(ctx, master)
  }

  /** Plays regardless of the category toggle — used by the Settings test buttons. */
  function preview(name: SfxName) {
    const ctx = ensureContext()
    if (!ctx || !master) return
    master.gain.setTargetAtTime(Math.max(0.15, settings.volume), ctx.currentTime, 0.01)
    SYNTH[name]?.(ctx, master)
  }

  return { play, preview }
}
