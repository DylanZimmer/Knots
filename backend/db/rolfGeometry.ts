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
  strand_x?: unknown
  strand_y?: unknown
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
    throw createHttpError(
      404,
      `Diagram ${diagramId} has no vertices_and_arrows_rolf rows`,
    )
  }

  const vertexPositionsByIndex: Array<Vertex | undefined> = []
  const arrowsByIndex: Array<Vertex | undefined> = []
  const crossingSpecs: CrossingSpec[] = []

  for (const row of vertexAndArrowRows) {
    const startPoint = parseNumericId(
      row.start_point,
      'vertices_and_arrows_rolf.start_point',
    )
    const endPoint = parseNumericId(
      row.end_point,
      'vertices_and_arrows_rolf.end_point',
    )
    const x = parseNumericId(row.strand_x, 'vertices_and_arrows_rolf.strand_x')
    const y = parseNumericId(row.strand_y, 'vertices_and_arrows_rolf.strand_y')

    vertexPositionsByIndex[startPoint] = [x, y]
    arrowsByIndex[startPoint] = [startPoint, endPoint]
  }

  for (const row of crossingSpecRows) {
    const crossingId = parseNumericId(
      row.crossing_id,
      'crossing_specs_rolf.crossing_id',
    )
    const underLine = parseNumericId(
      row.under_line,
      'crossing_specs_rolf.under_line',
    )
    const overLine = parseNumericId(
      row.over_line,
      'crossing_specs_rolf.over_line',
    )

    crossingSpecs.push([underLine, overLine, crossingId] as unknown as CrossingSpec)
  }

  return {
    vertex_positions: ensureDenseArray(
      vertexPositionsByIndex,
      'vertex_positions',
      diagramId,
    ),
    arrows: ensureDenseArray(arrowsByIndex, 'arrows', diagramId),
    crossing_specs: crossingSpecs,
  }
}

function getMappedDiagramId(
  row: RolfDiagramRecord | undefined,
  knotLabel: string,
) {
  if (!row || row.diagram_id == null) {
    throw createHttpError(404, `No stored diagram mapping for '${knotLabel}'`)
  }

  return parseNumericId(row.diagram_id, 'diagrams_rolf.diagram_id')
}

async function fetchMappedDiagramIdByField(
  fieldName: 'id' | 'name_rolf',
  value: number | string,
  knotLabel: string,
) {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('diagrams_rolf')
    .select('diagram_id')
    .eq(fieldName, value)
    .limit(1)

  if (error) {
    throw error
  }

  const row = ((data ?? []) as RolfDiagramRecord[])[0]
  return getMappedDiagramId(row, knotLabel)
}

async function fetchGeometryByDiagramId(diagramId: number): Promise<Geometry> {
  const supabase = getSupabase()

  const [
    { data: vertexAndArrowRows, error: vertexAndArrowError },
    { data: crossingSpecRows, error: crossingSpecError },
  ] = await Promise.all([
    supabase
      .from('vertices_and_arrows_rolf')
      .select('diagram_id, start_point, end_point, strand_x, strand_y')
      .eq('diagram_id', diagramId)
      .order('start_point'),
    supabase
      .from('crossing_specs_rolf')
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
  if (knotId != null) {
    const diagramId = await fetchMappedDiagramIdByField('id', knotId, name)
    return fetchGeometryByDiagramId(diagramId)
  }

  if (name.trim().length > 0) {
    const diagramId = await fetchMappedDiagramIdByField('name_rolf', name, name)
    return fetchGeometryByDiagramId(diagramId)
  }

  console.error('Knot id not found for rolf diagram data:', name)
  throw createHttpError(404, `No knot id for '${name}'`)
}
