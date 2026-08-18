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
  is_verified: boolean
  flag_count: number
  contributor_alias: string | null
  jitter_ms: number | null
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
  : null

export async function loadCommunityTests() {
  if (!supabase) return []

  // Try full query with community columns
  const fullResult = await supabase
    .from('speed_tests')
    .select(
      'id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,isp,city,country,created_at,updated_at,sample_count,is_verified,flag_count,contributor_alias,jitter_ms',
    )
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (!fullResult.error) return (fullResult.data ?? []) as CommunityTest[]

  // Fallback without community columns
  const mediumResult = await supabase
    .from('speed_tests')
    .select(
      'id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,isp,city,country,created_at,updated_at,sample_count',
    )
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (!mediumResult.error)
    return (mediumResult.data ?? []).map((t) => ({
      ...t,
      is_verified: (t as { sample_count: number }).sample_count >= 3,
      flag_count: 0,
      contributor_alias: null,
      jitter_ms: null,
    })) as CommunityTest[]

  // Fallback for base migration only
  const coreResult = await supabase
    .from('speed_tests')
    .select('id,latitude,longitude,download_mbps,upload_mbps,ping_ms,connection_type,created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (coreResult.error) throw coreResult.error
  return (coreResult.data ?? []).map((test) => ({
    ...test,
    isp: null,
    city: null,
    country: null,
    updated_at: test.created_at,
    sample_count: 1,
    is_verified: false,
    flag_count: 0,
    contributor_alias: null,
    jitter_ms: null,
  })) as CommunityTest[]
}

export async function saveCommunityTest(
  test: Omit<CommunityTest, 'id' | 'created_at' | 'updated_at' | 'sample_count' | 'is_verified' | 'flag_count'>,
) {
  if (!supabase) return null

  // Try extended RPC (requires latest migration)
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
    p_jitter_ms: test.jitter_ms,
    p_contributor_alias: test.contributor_alias,
  })
  if (!error) return data as CommunityTest

  // Fallback to original RPC signature
  const fallback = await supabase.rpc('log_speed_test', {
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
  if (fallback.error) throw new Error(`Database aggregation is unavailable: ${fallback.error.message}`)
  return fallback.data as CommunityTest
}

export async function flagCommunityTest(testId: string) {
  if (!supabase) return
  const { error } = await supabase.rpc('flag_speed_test', { p_test_id: testId })
  if (error) throw error
}
