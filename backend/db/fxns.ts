import { getSupabase } from '../supabase'

export interface Knot {
  id: string
  rolf_num: string
  extension: string
}

export async function insertKnot(knot: Knot) {
  console.log('insertKnot input:', knot)
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('knots')
    .insert([
      {
        id: knot.id,
        rolf_num: knot.rolf_num,
        extension: knot.extension
      }
    ])
    .select()
    
  if (error) {
    console.error('Error inserting knot:', error)
    throw error
  }

  return data[0]
}
