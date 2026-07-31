<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4 py-10 text-center">
    <div class="app-surface w-full max-w-3xl px-6 py-12 sm:px-10 sm:py-16 animate-fade-in-up">
      <div class="mb-5 flex justify-center">
        <UIcon name="i-lucide-shield-half" class="size-14 text-emerald-400 drop-shadow-[0_0_24px_rgba(52,211,153,0.45)]" />
      </div>
      <p class="app-kicker mb-4">
        Football Pitch Tactics
      </p>
      <h1 class="app-gradient-text mb-4 text-4xl font-bold leading-tight sm:text-5xl">
        Lead your club to glory.
      </h1>
      <p class="app-muted-text mx-auto mb-8 max-w-xl text-base sm:text-lg">
        Build your squad, pick your tactics, and dominate the league — one matchday at a time.
      </p>
      <UButton
        to="/new-game"
        label="Start New Game"
        icon="i-lucide-play"
        size="xl"
        class="w-full max-w-xs justify-center shadow-lg shadow-emerald-500/20 transition-shadow duration-300 hover:shadow-emerald-500/40"
      />
    </div>
  </div>
</template>