import type { CrossingSpec, Geometry, Vertex } from '../../shared/types.ts'
import { getSupabase } from '../supabase'
import { createHttpError, parseNumericId } from './common'

type RolfDiagramRecord = {
  diagram_id?: unknown
}

type VertexAndArrowRecord = {
  diagram_id?: unknown
  start_point?: unknown
  end_point?: unknown
  x?: unknown
  y?: unknown
}

type CrossingSpecRecord = {
  diagram_id?: unknown
  crossing_id?: unknown
  under_line?: unknown
  over_line?: unknown
}

function ensureDenseArray<T>(
  values: Array<T | undefined>,
  fieldName: string,
  diagramId: number,
): T[] {
  const missingIndex = values.findIndex((value) => value === undefined)

  if (missingIndex >= 0) {
    throw createHttpError(
      500,
      `Diagram ${diagramId} has incomplete ${fieldName} data at index ${missingIndex}`,
    )
  }

  return values as T[]
}

function buildGeometryFromRows(
  diagramId: number,
  vertexAndArrowRows: VertexAndArrowRecord[],
  crossingSpecRows: CrossingSpecRecord[],
): Geometry {
  if (vertexAndArrowRows.length === 0) {
    throw createHttpError(404, `Diagram ${diagramId} has no vertices_and_arrows rows`)
  }

  const vertexPositionsByIndex: Array<Vertex | undefined> = []
  const arrowsByIndex: Array<Vertex | undefined> = []
  const crossingSpecsByIndex: Array<CrossingSpec | undefined> = []

  for (const row of vertexAndArrowRows) {
    const startPoint = parseNumericId(row.start_point, 'vertices_and_arrows.start_point')
    const endPoint = parseNumericId(row.end_point, 'vertices_and_arrows.end_point')
    const x = parseNumericId(row.x, 'vertices_and_arrows.x')
    const y = parseNumericId(row.y, 'vertices_and_arrows.y')

    vertexPositionsByIndex[startPoint] = [x, y]
    arrowsByIndex[startPoint] = [startPoint, endPoint]
  }

  for (const row of crossingSpecRows) {
    const crossingId = parseNumericId(row.crossing_id, 'crossing_specs.crossing_id')
    const underLine = parseNumericId(row.under_line, 'crossing_specs.under_line')
    const overLine = parseNumericId(row.over_line, 'crossing_specs.over_line')

    crossingSpecsByIndex[crossingId] = [underLine, overLine, crossingId]
  }

  return {
    vertex_positions: ensureDenseArray(
      vertexPositionsByIndex,
      'vertex_positions',
      diagramId,
    ),
    arrows: ensureDenseArray(arrowsByIndex, 'arrows', diagramId),
    crossing_specs: ensureDenseArray(
      crossingSpecsByIndex,
      'crossing_specs',
      diagramId,
    ),
  }
}

async function fetchGeometryByDiagramId(diagramId: number): Promise<Geometry> {
  const supabase = getSupabase()

  const [
    { data: vertexAndArrowRows, error: vertexAndArrowError },
    { data: crossingSpecRows, error: crossingSpecError },
  ] = await Promise.all([
    supabase
      .from('vertices_and_arrows')
      .select('diagram_id, start_point, end_point, x, y')
      .eq('diagram_id', diagramId)
      .order('start_point'),
    supabase
      .from('crossing_specs')
      .select('diagram_id, crossing_id, under_line, over_line')
      .eq('diagram_id', diagramId)
      .order('crossing_id'),
  ])

  if (vertexAndArrowError) {
    throw vertexAndArrowError
  }

  if (crossingSpecError) {
    throw crossingSpecError
  }

  return buildGeometryFromRows(
    diagramId,
    (vertexAndArrowRows ?? []) as VertexAndArrowRecord[],
    (crossingSpecRows ?? []) as CrossingSpecRecord[],
  )
}

export async function getStoredRolfGeometryByKnot({
  knotId,
  name,
}: {
  knotId?: number | null
  name: string
}): Promise<Geometry> {
  const supabase = getSupabase()

  for (const [fieldName, queryValue] of [
    ['id', knotId],
    ['name', name],
  ] as const) {
    if (queryValue == null) {
      continue
    }

    const { data, error } = await supabase
      .from('diagrams_rolf')
      .select('diagram_id')
      .eq(fieldName, queryValue)
      .limit(1)

    if (error) {
      throw error
    }

    const row = ((data ?? []) as RolfDiagramRecord[])[0]
    if (!row) {
      continue
    }

    const diagramId = parseNumericId(row.diagram_id, 'diagrams_rolf.diagram_id')
    return fetchGeometryByDiagramId(diagramId)
  }

  console.error('Rolf diagram data not found for:', name)
  throw createHttpError(404, `No rolf diagram data for '${name}'`)
}
