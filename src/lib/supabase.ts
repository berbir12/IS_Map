import { createClient } from '@supabase/supabase-js'

export type CommunityTest = {
  id: string
  latitude: number
  longitude: number
  download_mbps: number
  upload_mbps: number
  ping_ms: number
  connection_type: string | null
  isp: string | null
  city: string | null
  country: string | null
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
  const fullResult = await supabase
    .from('speed_tests')
    .select('id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,isp,city,country,created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (!fullResult.error) return (fullResult.data ?? []) as CommunityTest[]

  // Projects that have only run the base migration can still persist and load tests.
  const coreResult = await supabase
    .from('speed_tests')
    .select('id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (coreResult.error) throw coreResult.error
  return (coreResult.data ?? []).map((test) => ({ ...test, isp: null, city: null, country: null })) as CommunityTest[]
}

export async function saveCommunityTest(test: Omit<CommunityTest, 'id' | 'created_at'>) {
  if (!supabase) return null
  const fullResult = await supabase.from('speed_tests').insert(test).select().single()
  if (!fullResult.error) return fullResult.data as CommunityTest

  const { isp: _isp, city: _city, country: _country, ...coreTest } = test
  const coreResult = await supabase.from('speed_tests').insert(coreTest).select().single()
  if (coreResult.error) throw coreResult.error
  return { ...coreResult.data, isp: null, city: null, country: null } as CommunityTest
}
