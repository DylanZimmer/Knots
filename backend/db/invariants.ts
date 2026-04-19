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

  for (const knotKey of ['id', 'name'] as const) {
    const queryValue = knotKey === 'id' ? knotId : name

    if (queryValue == null) {
      continue
    }

    const { data: invariantsRow, error: invariantsError } = await supabase
      .from('invariants_rolf')
      .select('id, name, determinant, alexander_polynomial, jones_polynomial')
      .eq(knotKey, queryValue)
      .single()

    if (!invariantsError && invariantsRow) {
      const {
        name: storedName,
        determinant,
        alexander_polynomial,
        jones_polynomial,
      } = invariantsRow as KnotInvariantsRecord

      return {
        name:
          typeof storedName === 'string' && storedName.trim().length > 0
            ? storedName
            : name,
        determinant: normalizeInvariantValue(determinant),
        alexander_polynomial: normalizeInvariantValue(alexander_polynomial),
        jones_polynomial: normalizeInvariantValue(jones_polynomial),
      }
    }
  }

  console.error('Knot invariants not found for:', name)
  throw createHttpError(404, `No invariants data for '${name}'`)
}

export async function getLatestCurrentInvariantsRow(): Promise<CurrentKnotInvariantsRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('invariants_current')
    .select('base_name, moves, determinant, alexander_polynomial, jones_polynomial')
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
    base_name:
      typeof row.base_name === 'string' && row.base_name.trim().length > 0
        ? row.base_name
        : 'current',
    determinant: normalizeInvariantValue(row.determinant),
    alexander_polynomial: normalizeInvariantValue(row.alexander_polynomial),
    jones_polynomial: normalizeInvariantValue(row.jones_polynomial),
  }
}

export async function initializeCurrentInvariants(name: string) {
  const supabase = getSupabase()
  const sourceInvariants = await getStoredKnotInvariants(name)
  await requireKnotIdByName(name, 'current invariants seed')

  const { error: clearError } = await supabase
    .from('invariants_current')
    .delete()
    .not('base_name', 'is', null)

  if (clearError) {
    throw clearError
  }

  const { error: insertError } = await supabase.from('invariants_current').insert([
    {
      base_name: sourceInvariants.name,
      moves: [],
      determinant: sourceInvariants.determinant,
      alexander_polynomial: sourceInvariants.alexander_polynomial,
      jones_polynomial: sourceInvariants.jones_polynomial,
    },
  ])

  if (insertError) {
    throw insertError
  }
}

export async function syncCurrentInvariantMoves(moves: string[]) {
  const supabase = getSupabase()

  const { error } = await supabase
    .from('invariants_current')
    .update({ moves })
    .not('base_name', 'is', null)

  if (error) {
    throw error
  }
}
