import { getSupabase } from '../supabase'
import {
  type KnotFullNotationRecord,
  type KnotIdRecord,
  type KnotMovesPayload,
  type KnotOptionRecord,
  createHttpError,
  parseJsonValue,
} from './common'

const KNOT_LIST_PAGE_SIZE = 1000

export interface Knot {
  name: string
  full_notation?: unknown
}

export async function insertKnot(knot: Knot) {
  console.log('insertKnot input:', knot)
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('knots')
    .insert([
      {
        name: knot.name,
        full_notation: knot.full_notation ?? null,
      },
    ])
    .select()

  if (error) {
    console.error('Error inserting knot:', error)
    throw error
  }

  return data[0]
}

export async function getKnotIdByName(name: string) {
  const supabase = getSupabase()

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('id')
    .eq('name', name)
    .single()

  return !knotError && knotRow ? (knotRow as KnotIdRecord).id : null
}

export async function requireKnotIdByName(name: string, context: string) {
  const knotId = await getKnotIdByName(name)

  if (knotId != null) {
    return knotId
  }

  console.error(`Knot id not found for ${context}:`, name)
  throw createHttpError(404, `No knot id for '${name}'`)
}

export async function getStoredKnotFullNotation(name: string): Promise<KnotMovesPayload> {
  const supabase = getSupabase()

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('name, full_notation')
    .eq('name', name)
    .single()

  if (knotError || !knotRow) {
    console.error('Knot full notation not found for:', name)
    throw createHttpError(404, `No full notation data for '${name}'`)
  }

  const { name: storedName, full_notation } = knotRow as KnotFullNotationRecord

  return {
    name:
      typeof storedName === 'string' && storedName.trim().length > 0
        ? storedName
        : name,
    full_notation: parseJsonValue(full_notation),
  }
}

export async function getAllKnotNames(
  ascending: boolean,
  paginate: boolean,
): Promise<string[]> {
  const supabase = getSupabase()

  if (!paginate) {
    const { data, error } = await supabase.from('knots').select('name').order('name', {
      ascending,
    })

    if (error) {
      throw error
    }

    return (data ?? [])
      .map((row: KnotOptionRecord) => row.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  }

  const knotNames: string[] = []
  let start = 0

  while (true) {
    const { data, error } = await supabase
      .from('knots')
      .select('name')
      .order('name', { ascending })
      .range(start, start + KNOT_LIST_PAGE_SIZE - 1)

    if (error) {
      throw error
    }

    const rows = (data ?? []) as KnotOptionRecord[]

    knotNames.push(
      ...rows
        .map((row) => row.name)
        .filter(
          (name): name is string =>
            typeof name === 'string' && name !== '0_1' && name.length > 0,
        ),
    )

    if (rows.length < KNOT_LIST_PAGE_SIZE) {
      break
    }

    start += rows.length
  }

  return knotNames
}
