<template>
  <div class="flex h-screen">
    <Sidebar />
    <main class="flex-1 p-8 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
