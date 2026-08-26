import { configureDatabase } from '../db'

/** Apply SQLite concurrency pragmas before the first request is handled. */
export default defineNitroPlugin(async () => {
  await configureDatabase()
})