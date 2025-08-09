// Returns the list of available tactics for the game
export default defineEventHandler(() => {
  return [
    {
      name: '4-4-2',
      formation: { GK: 1, DEF: 4, MID: 4, ATT: 2 },
      modifiers: { attack: 0, defence: 0 },
    },
    {
      name: '4-5-1',
      formation: { GK: 1, DEF: 4, MID: 5, ATT: 1 },
      modifiers: { attack: -1, defence: 1 },
    },
    {
      name: '4-3-3',
      formation: { GK: 1, DEF: 4, MID: 3, ATT: 3 },
      modifiers: { attack: 1, defence: -1 },
    },
    {
      name: '3-5-2',
      formation: { GK: 1, DEF: 3, MID: 5, ATT: 2 },
      modifiers: { attack: 1, defence: -2 },
    },
  ]
})
