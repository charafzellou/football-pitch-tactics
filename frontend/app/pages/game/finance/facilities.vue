<script setup lang="ts">
/**
 * The academy and the training ground — the Director of Football's half of the
 * job, and the only two purchases in this game that are worth nothing this
 * season.
 *
 * That is the whole design of the page. Neither facility can be justified from a
 * balance sheet that stops in May: an academy pays in graduates who are sixteen
 * now, and a training ground pays in a couple of skill points a player a year.
 * So every figure here is stated as *what it changes*, and the page points at
 * the four-season projection rather than pretending to a payback the current
 * season could show.
 */
import { computed, ref } from 'vue'
import { formatMoney, formatMoneyCompact } from '~/utils/format'

const toast = useAppToast()
const { refreshTeam } = useGameContext()
const { facilities, refresh, status } = useFinanceFacilities()
const { refresh: refreshSummary } = useFinanceSummary()
const { refresh: refreshProjection } = useFinanceProjection()

const saving = ref(false)
const pending = ref<'academy' | 'training' | null>(null)

function propose(facility: 'academy' | 'training') {
  pending.value = facility
}

const pendingName = computed(() => pending.value === 'academy' ? 'academy' : 'training ground')
const pendingState = computed(() =>
  pending.value === 'academy' ? facilities.value?.academy : facilities.value?.training)

async function upgrade(facility: 'academy' | 'training') {
  saving.value = true
  try {
    const result = await $fetch<{ tier: string }>('/api/finance/facilities', {
      method: 'POST',
      body: { facility },
    })
    await Promise.all([refresh(), refreshSummary(), refreshProjection(), refreshTeam()])
    toast.success({
      title: `Rebuilt — ${result.tier}`,
      description: facility === 'academy'
        ? 'The first graduates worth the money arrive next summer.'
        : 'Recovery improves immediately; development takes seasons.',
    })
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not commission the work')
  }
  finally {
    saving.value = false
    pending.value = null
  }
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-dumbbell" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Facilities</h1>
      <span v-if="facilities" class="app-chip ml-auto">
        {{ formatMoneyCompact(facilities.upkeepPerRound) }}/md upkeep
      </span>
    </div>

    <FinanceNav />

    <AppSkeleton v-if="status === 'pending' || !facilities" variant="card" />

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="app-elevated p-4">
          <p class="app-kicker text-[10px]">Available</p>
          <p class="app-hero-number mt-1 text-3xl">{{ formatMoneyCompact(facilities.balance) }}</p>
          <p class="app-muted-text mt-1 text-[11px]">{{ formatMoney(facilities.balance) }}</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Upkeep per matchday</p>
          <p class="app-hero-number mt-1 text-2xl" style="color: var(--app-player-sent-off)">
            {{ formatMoneyCompact(facilities.upkeepPerRound) }}
          </p>
          <p class="app-muted-text mt-1 text-[11px]">Charged whether or not you play at home</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Upkeep per season</p>
          <p class="app-hero-number mt-1 text-2xl">{{ formatMoneyCompact(facilities.upkeepPerSeason) }}</p>
          <p class="app-muted-text mt-1 text-[11px]">A better facility costs more to run, permanently</p>
        </div>
      </div>

      <div class="app-surface-subtle flex items-start gap-3 p-4">
        <UIcon name="i-lucide-hourglass" class="mt-0.5 size-5 shrink-0" style="color: var(--app-gold)" />
        <div class="min-w-0">
          <p class="text-sm font-bold" style="color: var(--app-text)">Neither of these pays back this season</p>
          <p class="app-muted-text mt-0.5 text-[11px]">
            An academy graduate is sixteen and a training ground is worth a point or two a player a year.
            The place to judge this decision is the
            <NuxtLink to="/game/finance/projection" class="underline">four-season projection</NuxtLink>,
            not the balance.
          </p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Academy -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-graduation-cap" class="size-4" style="color: var(--app-accent)" />
              Academy
              <span class="app-chip ml-auto">{{ facilities.academy.tier }}</span>
            </div>
          </template>

          <AppStatBar
            :value="Math.round((facilities.academy.level / facilities.maxLevel) * 100)"
            :tone="facilities.academy.atMax ? 'gold' : 'default'"
          />

          <dl class="mt-4 space-y-1.5 text-[11px]">
            <div class="flex justify-between">
              <dt class="app-muted-text">Graduate ability</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                {{ facilities.academy.current.skillBonus >= 0 ? '+' : '' }}{{ facilities.academy.current.skillBonus }}
                <template v-if="facilities.academy.next">
                  <span style="color: var(--app-accent)">
                    → {{ facilities.academy.next.skillBonus >= 0 ? '+' : '' }}{{ facilities.academy.next.skillBonus }}
                  </span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Graduate ceiling</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                {{ facilities.academy.current.potentialBonus >= 0 ? '+' : '' }}{{ facilities.academy.current.potentialBonus }}
                <template v-if="facilities.academy.next">
                  <span style="color: var(--app-accent)">
                    → {{ facilities.academy.next.potentialBonus >= 0 ? '+' : '' }}{{ facilities.academy.next.potentialBonus }}
                  </span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Graduates beyond the squad's needs</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                {{ facilities.academy.current.bonusGraduates }}
                <template v-if="facilities.academy.next">
                  <span style="color: var(--app-accent)">→ {{ facilities.academy.next.bonusGraduates }}</span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Upkeep</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                {{ formatMoneyCompact(facilities.academy.upkeepPerRound) }}/md
                <template v-if="facilities.academy.upkeepAfterUpgrade !== null">
                  → {{ formatMoneyCompact(facilities.academy.upkeepAfterUpgrade) }}/md
                </template>
              </dd>
            </div>
          </dl>

          <div v-if="!facilities.academy.atMax" class="mt-4 space-y-2">
            <p class="app-muted-text text-[11px]">
              Rebuilding to {{ facilities.academy.nextTier }} costs
              <span class="font-bold" style="color: var(--app-text)">{{ formatMoney(facilities.academy.cost) }}</span>.
            </p>
            <UButton
              :label="`Rebuild the academy`"
              icon="i-lucide-hammer"
              size="sm"
              :loading="saving"
              :disabled="!facilities.academy.canAfford"
              @click="propose('academy')"
            />
            <p v-if="!facilities.academy.canAfford" class="app-muted-text text-[11px]">
              You cannot afford this yet.
            </p>
          </div>
          <p v-else class="app-muted-text mt-4 text-[11px]">
            There is nothing left to build. Everything now depends on who you develop.
          </p>
        </UCard>

        <!-- Training ground -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-activity" class="size-4" style="color: var(--app-accent)" />
              Training ground
              <span class="app-chip ml-auto">{{ facilities.training.tier }}</span>
            </div>
          </template>

          <AppStatBar
            :value="Math.round((facilities.training.level / facilities.maxLevel) * 100)"
            :tone="facilities.training.atMax ? 'gold' : 'default'"
          />

          <dl class="mt-4 space-y-1.5 text-[11px]">
            <div class="flex justify-between">
              <dt class="app-muted-text">Development rate</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                {{ facilities.training.current.developmentPercent >= 0 ? '+' : '' }}{{ facilities.training.current.developmentPercent }}%
                <template v-if="facilities.training.next">
                  <span style="color: var(--app-accent)">
                    → {{ facilities.training.next.developmentPercent >= 0 ? '+' : '' }}{{ facilities.training.next.developmentPercent }}%
                  </span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Decline slowed by</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                {{ facilities.training.current.declinePercent }}%
                <template v-if="facilities.training.next">
                  <span style="color: var(--app-accent)">→ {{ facilities.training.next.declinePercent }}%</span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Stamina recovered per match</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                +{{ facilities.training.current.staminaPerMatch }}
                <template v-if="facilities.training.next">
                  <span style="color: var(--app-accent)">→ +{{ facilities.training.next.staminaPerMatch }}</span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Chance of an early return from injury</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                {{ facilities.training.current.injuryRecoveryPercent }}%
                <template v-if="facilities.training.next">
                  <span style="color: var(--app-accent)">→ {{ facilities.training.next.injuryRecoveryPercent }}%</span>
                </template>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="app-muted-text">Upkeep</dt>
              <dd class="font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                {{ formatMoneyCompact(facilities.training.upkeepPerRound) }}/md
                <template v-if="facilities.training.upkeepAfterUpgrade !== null">
                  → {{ formatMoneyCompact(facilities.training.upkeepAfterUpgrade) }}/md
                </template>
              </dd>
            </div>
          </dl>

          <div v-if="!facilities.training.atMax" class="mt-4 space-y-2">
            <p class="app-muted-text text-[11px]">
              Rebuilding to {{ facilities.training.nextTier }} costs
              <span class="font-bold" style="color: var(--app-text)">{{ formatMoney(facilities.training.cost) }}</span>.
            </p>
            <UButton
              label="Rebuild the training ground"
              icon="i-lucide-hammer"
              size="sm"
              :loading="saving"
              :disabled="!facilities.training.canAfford"
              @click="propose('training')"
            />
            <p v-if="!facilities.training.canAfford" class="app-muted-text text-[11px]">
              You cannot afford this yet.
            </p>
          </div>
          <p v-else class="app-muted-text mt-4 text-[11px]">
            There is nothing left to build. Recovery and development are as good as this club can make them.
          </p>
        </UCard>
      </div>
    </template>

    <AppConfirmModal
      :open="pending !== null"
      tone="warning"
      icon="i-lucide-hammer"
      :title="`Rebuild the ${pendingName}?`"
      description="The money goes now. The benefit arrives over the seasons that follow, and the upkeep never stops."
      confirm-label="Commission the work"
      confirm-icon="i-lucide-hammer"
      :loading="saving"
      @confirm="pending && upgrade(pending)"
      @cancel="pending = null"
    >
      <template #consequences>
        <li v-if="pendingState">{{ formatMoney(pendingState.cost) }} leaves the account today</li>
        <li v-if="pendingState?.upkeepAfterUpgrade !== null && pendingState">
          Upkeep rises to {{ formatMoney(pendingState.upkeepAfterUpgrade!) }} every matchday, permanently
        </li>
        <li>Nothing about this season changes</li>
      </template>
    </AppConfirmModal>
  </div>
</template>
