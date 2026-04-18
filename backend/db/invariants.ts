import { getSupabase } from '../supabase'
import {
  type CurrentKnotInvariantsRecord,
  type KnotInvariantsRecord,
  createHttpError,
  normalizeInvariantValue,
} from './common'
import { getKnotIdByName, requireKnotIdByName } from './knots'

export async function getStoredKnotInvariants(name: string) {
  const supabase = getSupabase()
  const knotId = await getKnotIdByName(name)

  for (const knotKey of ['name', 'knot_name', 'base_name', 'knot_id', 'id'] as const) {
    const queryValue = knotKey === 'knot_id' || knotKey === 'id' ? knotId : name

    if (queryValue == null) {
      continue
    }

    const { data: invariantsRow, error: invariantsError } = await supabase
      .from('invariants_rolf')
      .select('*')
      .eq(knotKey, queryValue)
      .single()

    if (!invariantsError && invariantsRow) {
      const {
        name: storedName,
        knot_name: knotName,
        base_name: baseName,
        alexander_polynomial,
        Alexander_polynomial,
      } = invariantsRow as KnotInvariantsRecord

      return {
        name:
          typeof baseName === 'string' && baseName.trim().length > 0
            ? baseName
            : typeof knotName === 'string' && knotName.trim().length > 0
              ? knotName
              : typeof storedName === 'string' && storedName.trim().length > 0
                ? storedName
                : name,
        alexander_polynomial: normalizeInvariantValue(
          alexander_polynomial ?? Alexander_polynomial,
        ),
      }
    }
  }

  console.error('Knot invariants not found for:', name)
  throw createHttpError(404, `No invariants data for '${name}'`)
}

export async function getLatestCurrentInvariantsRow(): Promise<CurrentKnotInvariantsRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('current_invariants')
    .select('id, base_name, alexander_polynomial')
    .order('id', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const row = ((data ?? []) as CurrentKnotInvariantsRecord[])[0]

  if (!row) {
    throw createHttpError(404, 'No current invariants are available')
  }

  return row
}

export async function getCurrentKnotInvariants() {
  const row = await getLatestCurrentInvariantsRow()

  return {
    id: normalizeInvariantValue(row.id),
    base_name:
      typeof row.base_name === 'string' && row.base_name.trim().length > 0
        ? row.base_name
        : 'current',
    alexander_polynomial: normalizeInvariantValue(row.alexander_polynomial),
  }
}

export async function initializeCurrentInvariants(name: string) {
  const supabase = getSupabase()
  const sourceInvariants = await getStoredKnotInvariants(name)
  const knotId = await requireKnotIdByName(name, 'current invariants seed')

  const { error: clearError } = await supabase
    .from('current_invariants')
    .delete()
    .not('id', 'is', null)

  if (clearError) {
    throw clearError
  }

  const { error: insertError } = await supabase.from('current_invariants').insert([
    {
      id: knotId,
      base_name: sourceInvariants.name,
      alexander_polynomial: sourceInvariants.alexander_polynomial,
    },
  ])

  if (insertError) {
    throw insertError
  }
}
