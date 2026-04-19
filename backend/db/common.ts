export type DiagramGeometryPayload = {
  name: string
  moves?: string[]
  vertex_positions: unknown
  arrows: unknown
  crossing_specs: unknown
}

export type KnotMovesPayload = {
  name: string
  full_notation: unknown
}

export type KnotOptionRecord = {
  name: string
}

export type KnotIdRecord = {
  id: unknown
}

export type KnotInvariantsRecord = {
  id?: unknown
  name?: unknown
  determinant?: unknown
  alexander_polynomial?: unknown
  jones_polynomial?: unknown
}

export type KnotFullNotationRecord = {
  name: unknown
  full_notation: unknown
}

export type CurrentKnotDiagramRecord = {
  base_name: unknown
  moves: unknown
  vertex_positions: unknown
  arrows: unknown
  crossing_specs: unknown
}

export type CurrentKnotInvariantsRecord = {
  base_name: unknown
  moves: unknown
  determinant: unknown
  alexander_polynomial: unknown
  jones_polynomial: unknown
}

export type HttpError = Error & { status?: number }

export function createHttpError(status: number, message: string) {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

export function parseJsonText(text: string) {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function parseJsonValue(value: unknown) {
  if (typeof value !== 'string') {
    return value
  }

  return parseJsonText(value)
}

export function parseNumericId(value: unknown, fieldName: string) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numericValue)) {
    throw createHttpError(500, `${fieldName} must be numeric`)
  }

  return numericValue
}

export function normalizeInvariantValue(value: unknown) {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  return JSON.stringify(value)
}

export function normalizeMovesValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((move): move is string => typeof move === 'string')
      .map((move) => move.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((move) => move.trim())
      .filter(Boolean)
  }

  return []
}
