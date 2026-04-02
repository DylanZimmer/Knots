import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '.env') })

export function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  console.log('getSupabase env check:', {
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasServiceRoleKey: Boolean(supabaseKey),
  })

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required.')
  }
  if (!supabaseKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.')
  }
  return createClient(supabaseUrl, supabaseKey)
}
