import { getSupabase } from '../supabase'
import {
  type DiagramGeometryPayload,
  createHttpError,
  normalizeMovesValue,
  parseNumericId,
  parseJsonValue,
} from './common'
import { getKnotIdByName, requireKnotIdByName } from './knots'
import { getStoredRolfGeometryByKnot } from './rolfGeometry'

type DiagramRowRecord = {
  diagram_id?: unknown
  extension?: unknown
  name_rolf?: unknown
  given_name?: unknown
}

type VertexAndArrowRowRecord = {
  diagram_id?: unknown
  extension?: unknown
  start_point?: unknown
  end_point?: unknown
  strand_x?: unknown
  strand_y?: unknown
}

type CrossingSpecRowRecord = {
  diagram_id?: unknown
  extension?: unknown
  crossing_id?: unknown
  under_line?: unknown
  over_line?: unknown
}

type MoveRowRecord = {
  extension?: unknown
  move_name?: unknown
}

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

function getCurrentDiagramName(row: DiagramRowRecord) {
  if (typeof row.given_name === 'string' && row.given_name.trim().length > 0) {
    return row.given_name
  }

  if (typeof row.name_rolf === 'string' && row.name_rolf.trim().length > 0) {
    return row.name_rolf
  }

  return 'current'
}

function ensureDenseArray<T>(
  values: Array<T | undefined>,
  fieldName: string,
  diagramId: number,
  extension: number,
): T[] {
  const missingIndex = values.findIndex((value) => value === undefined)

  if (missingIndex >= 0) {
    throw createHttpError(
      500,
      `Diagram ${diagramId} extension ${extension} has incomplete ${fieldName} data at index ${missingIndex}`,
    )
  }

  return values as T[]
}

function buildGeometryFromRows(
  diagramId: number,
  extension: number,
  vertexAndArrowRows: VertexAndArrowRowRecord[],
  crossingSpecRows: CrossingSpecRowRecord[],
) {
  if (vertexAndArrowRows.length === 0) {
    throw createHttpError(
      404,
      `Diagram ${diagramId} extension ${extension} has no vertices_and_arrows rows`,
    )
  }

  const vertexPositionsByIndex: Array<[number, number] | undefined> = []
  const arrowsByIndex: Array<[number, number] | undefined> = []
  const crossingSpecs: Array<[number, number, number]> = []

  for (const row of vertexAndArrowRows) {
    const startPoint = parseNumericId(
      row.start_point,
      'vertices_and_arrows.start_point',
    )
    const endPoint = parseNumericId(row.end_point, 'vertices_and_arrows.end_point')
    const x = parseNumericId(row.strand_x, 'vertices_and_arrows.strand_x')
    const y = parseNumericId(row.strand_y, 'vertices_and_arrows.strand_y')

    vertexPositionsByIndex[startPoint] = [x, y]
    arrowsByIndex[startPoint] = [startPoint, endPoint]
  }

  for (const row of crossingSpecRows) {
    const crossingId = parseNumericId(row.crossing_id, 'crossing_specs.crossing_id')
    const underLine = parseNumericId(row.under_line, 'crossing_specs.under_line')
    const overLine = parseNumericId(row.over_line, 'crossing_specs.over_line')

    crossingSpecs.push([underLine, overLine, crossingId])
  }

  return {
    vertex_positions: ensureDenseArray(
      vertexPositionsByIndex,
      'vertex_positions',
      diagramId,
      extension,
    ),
    arrows: ensureDenseArray(arrowsByIndex, 'arrows', diagramId, extension),
    crossing_specs: crossingSpecs,
  }
}

async function getCurrentDiagramGeometryRows(
  diagramId: number,
  extension: number,
) {
  const supabase = getSupabase()

  const [
    { data: vertexAndArrowRows, error: vertexAndArrowError },
    { data: crossingSpecRows, error: crossingSpecError },
  ] = await Promise.all([
    supabase
      .from('vertices_and_arrows')
      .select('diagram_id, extension, start_point, end_point, strand_x, strand_y')
      .eq('diagram_id', diagramId)
      .eq('extension', extension)
      .order('start_point'),
    supabase
      .from('crossing_specs')
      .select('diagram_id, extension, crossing_id, under_line, over_line')
      .eq('diagram_id', diagramId)
      .eq('extension', extension)
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
    extension,
    (vertexAndArrowRows ?? []) as VertexAndArrowRowRecord[],
    (crossingSpecRows ?? []) as CrossingSpecRowRecord[],
  )
}

async function getCurrentDiagramMoves(diagramId: number) {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('moves')
    .select('extension, move_name')
    .eq('diagram_id', diagramId)
    .order('extension')

  if (error) {
    throw error
  }

  return ((data ?? []) as MoveRowRecord[])
    .map((row) => row.move_name)
    .filter((moveName): moveName is string => typeof moveName === 'string')
    .map((moveName) => moveName.trim())
    .filter(Boolean)
}

export async function getLatestCurrentDiagramRow(): Promise<DiagramRowRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('diagrams')
    .select('diagram_id, extension, name_rolf, given_name')
    .order('extension', { ascending: false })
    .order('diagram_id', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const row = ((data ?? []) as DiagramRowRecord[])[0]

  if (!row) {
    throw createHttpError(404, 'No current knot diagram is available')
  }

  return row
}

export async function getCurrentDiagramGeometry(): Promise<DiagramGeometryPayload> {
  const row = await getLatestCurrentDiagramRow()
  const diagramId = parseNumericId(row.diagram_id, 'diagrams.diagram_id')
  const extension = parseNumericId(row.extension, 'diagrams.extension')
  const [geometry, moves] = await Promise.all([
    getCurrentDiagramGeometryRows(diagramId, extension),
    getCurrentDiagramMoves(diagramId),
  ])

  return {
    name: getCurrentDiagramName(row),
    moves,
    vertex_positions: geometry.vertex_positions,
    arrows: geometry.arrows,
    crossing_specs: geometry.crossing_specs,
  }
}

async function clearCurrentDiagramTables() {
  const supabase = getSupabase()

  for (const tableName of [
    'moves',
    'crossing_specs',
    'vertices_and_arrows',
    'diagrams',
  ] as const) {
    const { error } = await supabase
      .from(tableName)
      .delete()
      .not('diagram_id', 'is', null)

    if (error) {
      throw error
    }
  }
}

function toArrayValue(value: unknown, fieldName: string) {
  const parsedValue = parseJsonValue(value)

  if (!Array.isArray(parsedValue)) {
    throw createHttpError(400, `${fieldName} must be an array`)
  }

  return parsedValue
}

function getCrossingIdValue(crossingSpec: unknown[], index: number) {
  if (crossingSpec.length >= 4) {
    return crossingSpec[3]
  }

  if (crossingSpec.length >= 3) {
    return crossingSpec[2]
  }

  throw createHttpError(
    400,
    `crossing_specs[${index}] must contain at least [under_line, over_line, crossing_id]`,
  )
}

async function insertCurrentDiagramSnapshot({
  diagramId,
  extension,
  name,
  payload,
  moveName,
}: {
  diagramId: number
  extension: number
  name: string
  payload: DiagramGeometryPayload
  moveName?: string
}) {
  const supabase = getSupabase()
  const vertexPositions = toArrayValue(payload.vertex_positions, 'vertex_positions')
  const arrows = toArrayValue(payload.arrows, 'arrows')
  const crossingSpecs = toArrayValue(payload.crossing_specs, 'crossing_specs')

  if (vertexPositions.length !== arrows.length) {
    throw createHttpError(
      400,
      `vertex_positions length ${vertexPositions.length} does not match arrows length ${arrows.length}`,
    )
  }

  const { error: diagramInsertError } = await supabase.from('diagrams').insert([
    {
      diagram_id: diagramId,
      extension,
      name_rolf: name,
      given_name: name,
      conversion_for_full_notation: null,
      start_line: null,
    },
  ])

  if (diagramInsertError) {
    throw diagramInsertError
  }

  const vertexAndArrowRows = vertexPositions.map((position, index) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw createHttpError(
        400,
        `vertex_positions[${index}] must contain [strand_x, strand_y]`,
      )
    }

    const arrow = arrows[index]
    if (!Array.isArray(arrow) || arrow.length < 2) {
      throw createHttpError(400, `arrows[${index}] must contain [start_point, end_point]`)
    }

    const startPoint = parseNumericId(arrow[0], `arrows[${index}][0]`)
    const endPoint = parseNumericId(arrow[1], `arrows[${index}][1]`)
    if (startPoint !== index) {
      throw createHttpError(
        400,
        `Expected arrows[${index}][0] to equal ${index}, got ${startPoint}`,
      )
    }

    return {
      diagram_id: diagramId,
      extension,
      start_point: startPoint,
      end_point: endPoint,
      strand_x: parseNumericId(position[0], `vertex_positions[${index}][0]`),
      strand_y: parseNumericId(position[1], `vertex_positions[${index}][1]`),
    }
  })

  if (vertexAndArrowRows.length > 0) {
    const { error: vertexInsertError } = await supabase
      .from('vertices_and_arrows')
      .insert(vertexAndArrowRows)

    if (vertexInsertError) {
      throw vertexInsertError
    }
  }

  const crossingRows = crossingSpecs.map((crossingSpec, index) => {
    if (!Array.isArray(crossingSpec) || crossingSpec.length < 3) {
      throw createHttpError(
        400,
        `crossing_specs[${index}] must contain at least [under_line, over_line, crossing_id]`,
      )
    }

    return {
      diagram_id: diagramId,
      extension,
      crossing_id: parseNumericId(
        getCrossingIdValue(crossingSpec, index),
        `crossing_specs[${index}]`,
      ),
      under_line: parseNumericId(crossingSpec[0], `crossing_specs[${index}][0]`),
      over_line: parseNumericId(crossingSpec[1], `crossing_specs[${index}][1]`),
    }
  })

  if (crossingRows.length > 0) {
    const { error: crossingInsertError } = await supabase
      .from('crossing_specs')
      .insert(crossingRows)

    if (crossingInsertError) {
      throw crossingInsertError
    }
  }

  if (moveName) {
    const { error: moveInsertError } = await supabase.from('moves').insert([
      {
        diagram_id: diagramId,
        extension,
        move_name: moveName,
      },
    ])

    if (moveInsertError) {
      throw moveInsertError
    }
  }
}

export async function initializeCurrentDiagram(name: string): Promise<DiagramGeometryPayload> {
  const sourceGeometry = await getStoredRolfDiagramGeometry(name)
  const diagramId = parseNumericId(
    await requireKnotIdByName(name, 'current diagram seed'),
    'knots.id',
  )

  await clearCurrentDiagramTables()
  await insertCurrentDiagramSnapshot({
    diagramId,
    extension: 0,
    name,
    payload: {
      ...sourceGeometry,
      moves: [],
    },
  })

  return getCurrentDiagramGeometry()
}

async function appendCurrentDiagramMove(
  moveName: string,
  transform: (payload: DiagramGeometryPayload) => DiagramGeometryPayload,
) {
  const currentRow = await getLatestCurrentDiagramRow()
  const diagramId = parseNumericId(currentRow.diagram_id, 'diagrams.diagram_id')
  const extension = parseNumericId(currentRow.extension, 'diagrams.extension')
  const currentPayload = await getCurrentDiagramGeometry()
  const nextMoves = [...normalizeMovesValue(currentPayload.moves), moveName]
  const nextPayload = transform({
    ...currentPayload,
    moves: nextMoves,
  })

  await insertCurrentDiagramSnapshot({
    diagramId,
    extension: extension + 1,
    name: getCurrentDiagramName(currentRow),
    payload: nextPayload,
    moveName,
  })

  return getCurrentDiagramGeometry()
}

export async function appendFlipOrientationCurrentDiagram(): Promise<DiagramGeometryPayload> {
  return appendCurrentDiagramMove('flip', (currentPayload) => ({
    ...currentPayload,
    arrows: reverseArrowPairs(currentPayload.arrows),
  }))
}

export async function appendMirrorCurrentDiagram(): Promise<DiagramGeometryPayload> {
  return appendCurrentDiagramMove('mirror', (currentPayload) => ({
    ...currentPayload,
    crossing_specs: reverseCrossingSpecPairs(currentPayload.crossing_specs),
  }))
}
