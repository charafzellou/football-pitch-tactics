import type { Tactic } from './match-engine'

export const TACTICS: Tactic[] = [
  {
    name: '4-4-2',
    formation: { GK: 1, DF: 4, MF: 4, FW: 2 },
    modifiers: { attack: 0, defence: 0 },
  },
  {
    name: '4-5-1',
    formation: { GK: 1, DF: 4, MF: 5, FW: 1 },
    modifiers: { attack: -1, defence: 1 },
  },
  {
    name: '4-3-3',
    formation: { GK: 1, DF: 4, MF: 3, FW: 3 },
    modifiers: { attack: 1, defence: -1 },
  },
  {
    name: '3-5-2',
    formation: { GK: 1, DF: 3, MF: 5, FW: 2 },
    modifiers: { attack: 1, defence: -2 },
  },
]