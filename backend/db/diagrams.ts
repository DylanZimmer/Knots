import { getSupabase } from '../supabase'
import {
  type CurrentKnotDiagramRecord,
  type DiagramGeometryPayload,
  createHttpError,
  normalizeMovesValue,
  parseNumericId,
  parseJsonValue,
} from './common'
import { initializeCurrentInvariants, syncCurrentInvariantMoves } from './invariants'
import { getKnotIdByName, requireKnotIdByName } from './knots'
import { getStoredRolfGeometryByKnot } from './rolfGeometry'

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
  const knotIdValue = await getKnotIdByName(name)
  const geometry = await getStoredRolfGeometryByKnot({
    knotId:
      knotIdValue == null ? null : parseNumericId(knotIdValue, 'knots.id'),
    name,
  })

  return {
    name,
    vertex_positions: geometry.vertex_positions,
    arrows: geometry.arrows,
    crossing_specs: geometry.crossing_specs,
  }
}

export async function getLatestCurrentDiagramRow(): Promise<CurrentKnotDiagramRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('diagrams_current')
    .select('base_name, moves, vertex_positions, arrows, crossing_specs')
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
    moves: normalizeMovesValue(row.moves),
    vertex_positions: parseJsonValue(row.vertex_positions),
    arrows: parseJsonValue(row.arrows),
    crossing_specs: parseJsonValue(row.crossing_specs),
  }
}

async function replaceCurrentDiagramRow(payload: DiagramGeometryPayload) {
  const supabase = getSupabase()

  const { error: clearError } = await supabase
    .from('diagrams_current')
    .delete()
    .not('base_name', 'is', null)

  if (clearError) {
    throw clearError
  }

  const { error: insertError } = await supabase.from('diagrams_current').insert([
    {
      base_name: payload.name,
      moves: payload.moves ?? [],
      vertex_positions: payload.vertex_positions,
      arrows: payload.arrows,
      crossing_specs: payload.crossing_specs,
    },
  ])

  if (insertError) {
    throw insertError
  }
}

export async function initializeCurrentDiagram(name: string): Promise<DiagramGeometryPayload> {
  const sourceGeometry = await getStoredRolfDiagramGeometry(name)
  await requireKnotIdByName(name, 'current diagram seed')

  await replaceCurrentDiagramRow({
    ...sourceGeometry,
    moves: [],
  })

  await initializeCurrentInvariants(name)

  return getCurrentDiagramGeometry()
}

export async function appendFlipOrientationCurrentDiagram(): Promise<DiagramGeometryPayload> {
  const currentRow = await getLatestCurrentDiagramRow()
  const nextMoves = [...normalizeMovesValue(currentRow.moves), 'flip']

  await replaceCurrentDiagramRow({
    name: typeof currentRow.base_name === 'string' ? currentRow.base_name : 'current',
    moves: nextMoves,
    vertex_positions: parseJsonValue(currentRow.vertex_positions),
    arrows: reverseArrowPairs(parseJsonValue(currentRow.arrows)),
    crossing_specs: parseJsonValue(currentRow.crossing_specs),
  })
  await syncCurrentInvariantMoves(nextMoves)

  return getCurrentDiagramGeometry()
}

export async function appendMirrorCurrentDiagram(): Promise<DiagramGeometryPayload> {
  const currentRow = await getLatestCurrentDiagramRow()
  const nextMoves = [...normalizeMovesValue(currentRow.moves), 'mirror']

  await replaceCurrentDiagramRow({
    name: typeof currentRow.base_name === 'string' ? currentRow.base_name : 'current',
    moves: nextMoves,
    vertex_positions: parseJsonValue(currentRow.vertex_positions),
    arrows: parseJsonValue(currentRow.arrows),
    crossing_specs: reverseCrossingSpecPairs(parseJsonValue(currentRow.crossing_specs)),
  })
  await syncCurrentInvariantMoves(nextMoves)

  return getCurrentDiagramGeometry()
}
