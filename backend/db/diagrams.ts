import { getSupabase } from '../supabase'
import {
  type CurrentKnotDiagramRecord,
  type DiagramGeometryPayload,
  createHttpError,
  parseJsonValue,
  parseNumericId,
} from './common'
import { initializeCurrentInvariants } from './invariants'
import { getKnotIdByName, requireKnotIdByName } from './knots'

function reverseArrowPairs(arrows: unknown) {
  if (!Array.isArray(arrows)) {
    return arrows
  }

  return arrows.map((arrow) => {
    if (!Array.isArray(arrow) || arrow.length < 2) {
      return arrow
    }

    return [arrow[1], arrow[0], ...arrow.slice(2)]
  })
}

function reverseCrossingSpecPairs(crossingSpecs: unknown) {
  if (!Array.isArray(crossingSpecs)) {
    return crossingSpecs
  }

  return crossingSpecs.map((crossingSpec) => {
    if (!Array.isArray(crossingSpec) || crossingSpec.length < 2) {
      return crossingSpec
    }

    return [crossingSpec[1], crossingSpec[0], ...crossingSpec.slice(2)]
  })
}

export async function getStoredRolfDiagramGeometry(
  name: string,
): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const knotId = await getKnotIdByName(name)

  for (const knotKey of ['id', 'knot_id', 'knot_name', 'name'] as const) {
    const queryValue = knotKey === 'id' || knotKey === 'knot_id' ? knotId : name

    if (queryValue == null) {
      continue
    }

    const { data: diagramRow, error: diagramError } = await supabase
      .from('knot_diagrams_rolf')
      .select('vertex_positions, arrows, crossing_specs')
      .eq(knotKey, queryValue)
      .single()

    if (!diagramError && diagramRow) {
      return {
        name,
        vertex_positions: parseJsonValue(diagramRow.vertex_positions),
        arrows: parseJsonValue(diagramRow.arrows),
        crossing_specs: parseJsonValue(diagramRow.crossing_specs),
      }
    }
  }

  console.error('Rolf diagram data not found for:', name)
  throw createHttpError(404, `No rolf diagram data for '${name}'`)
}

export async function getLatestCurrentDiagramRow(): Promise<CurrentKnotDiagramRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('current_knot_diagram')
    .select('id, base_name, moves, vertex_positions, arrows, crossing_specs')
    .order('id', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const row = ((data ?? []) as CurrentKnotDiagramRecord[])[0]

  if (!row) {
    throw createHttpError(404, 'No current knot diagram is available')
  }

  return row
}

export async function getCurrentDiagramGeometry(): Promise<DiagramGeometryPayload> {
  const row = await getLatestCurrentDiagramRow()

  return {
    name:
      typeof row.base_name === 'string' && row.base_name.trim().length > 0
        ? row.base_name
        : 'current',
    moves: typeof row.moves === 'string' ? row.moves : '',
    vertex_positions: parseJsonValue(row.vertex_positions),
    arrows: parseJsonValue(row.arrows),
    crossing_specs: parseJsonValue(row.crossing_specs),
  }
}

export async function initializeCurrentDiagram(name: string): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const sourceGeometry = await getStoredRolfDiagramGeometry(name)
  const knotId = await requireKnotIdByName(name, 'current diagram seed')

  const { error: clearError } = await supabase
    .from('current_knot_diagram')
    .delete()
    .not('id', 'is', null)

  if (clearError) {
    throw clearError
  }

  const { error: insertError } = await supabase.from('current_knot_diagram').insert([
    {
      id: knotId,
      base_name: name,
      moves: '',
      vertex_positions: sourceGeometry.vertex_positions,
      arrows: sourceGeometry.arrows,
      crossing_specs: sourceGeometry.crossing_specs,
    },
  ])

  if (insertError) {
    throw insertError
  }

  await initializeCurrentInvariants(name)

  return getCurrentDiagramGeometry()
}

export async function appendFlipOrientationCurrentDiagram(): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const currentRow = await getLatestCurrentDiagramRow()
  const currentMoves = typeof currentRow.moves === 'string' ? currentRow.moves.trim() : ''
  const nextMoves = currentMoves ? `${currentMoves}, flip` : 'flip'
  const nextId = parseNumericId(currentRow.id, 'current_knot_diagram.id') + 0.1

  const { error: insertError } = await supabase.from('current_knot_diagram').insert([
    {
      id: nextId,
      base_name: currentRow.base_name,
      moves: nextMoves,
      vertex_positions: parseJsonValue(currentRow.vertex_positions),
      arrows: reverseArrowPairs(parseJsonValue(currentRow.arrows)),
      crossing_specs: parseJsonValue(currentRow.crossing_specs),
    },
  ])

  if (insertError) {
    throw insertError
  }

  return getCurrentDiagramGeometry()
}

export async function appendMirrorCurrentDiagram(): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const currentRow = await getLatestCurrentDiagramRow()
  const currentMoves = typeof currentRow.moves === 'string' ? currentRow.moves.trim() : ''
  const nextMoves = currentMoves ? `${currentMoves}, mirror` : 'mirror'
  const nextId = parseNumericId(currentRow.id, 'current_knot_diagram.id') + 0.1

  const { error: insertError } = await supabase.from('current_knot_diagram').insert([
    {
      id: nextId,
      base_name: currentRow.base_name,
      moves: nextMoves,
      vertex_positions: parseJsonValue(currentRow.vertex_positions),
      arrows: parseJsonValue(currentRow.arrows),
      crossing_specs: reverseCrossingSpecPairs(parseJsonValue(currentRow.crossing_specs)),
    },
  ])

  if (insertError) {
    throw insertError
  }

  return getCurrentDiagramGeometry()
}
