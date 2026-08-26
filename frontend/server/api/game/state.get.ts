import { activeSave } from '../../../server/core/save'

export default defineEventHandler(async (event) => {
  return activeSave(event)
})
