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
  updated_at: string
  sample_count: number
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
    .select('id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,isp,city,country,created_at,updated_at,sample_count')
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (!fullResult.error) return (fullResult.data ?? []) as CommunityTest[]

  // Projects that have only run the base migration can still persist and load tests.
  const coreResult = await supabase
    .from('speed_tests')
    .select('id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (coreResult.error) throw coreResult.error
  return (coreResult.data ?? []).map((test) => ({ ...test, isp: null, city: null, country: null, updated_at: test.created_at, sample_count: 1 })) as CommunityTest[]
}

export async function saveCommunityTest(test: Omit<CommunityTest, 'id' | 'created_at' | 'updated_at' | 'sample_count'>) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('log_speed_test', {
    p_latitude: test.latitude,
    p_longitude: test.longitude,
    p_download_mbps: test.download_mbps,
    p_upload_mbps: test.upload_mbps,
    p_ping_ms: test.ping_ms,
    p_connection_type: test.connection_type,
    p_isp: test.isp,
    p_city: test.city,
    p_country: test.country,
  })
  if (error) throw new Error(`Database aggregation is unavailable: ${error.message}`)
  return data as CommunityTest
}
