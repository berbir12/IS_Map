import { createClient } from '@supabase/supabase-js'

export type CommunityTest = {
  id: string
  latitude: number
  longitude: number
  download_mbps: number
  upload_mbps: number
  ping_ms: number
  connection_type: string | null
  created_at: string
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
  : null

export async function loadCommunityTests() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('speed_tests')
    .select('id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return (data ?? []) as CommunityTest[]
}

export async function saveCommunityTest(test: Omit<CommunityTest, 'id' | 'created_at'>) {
  if (!supabase) return null
  const { data, error } = await supabase.from('speed_tests').insert(test).select().single()
  if (error) throw error
  return data as CommunityTest
}
