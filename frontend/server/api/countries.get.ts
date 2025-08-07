import { db } from '../db'

export default defineEventHandler(async () => {
  return await db.query.countries.findMany()
})
