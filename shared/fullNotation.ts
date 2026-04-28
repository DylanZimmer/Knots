import type { FullNotation, FullNotationLine, Placement } from './types.ts'

function isPlacement(value: unknown): value is Placement {
  return value === 'over' || value === 'under'
}

function toFiniteNumber(value: unknown): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeArcPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }

  const left = toFiniteNumber(value[0])
  const right = toFiniteNumber(value[1])

  if (left == null || right == null) {
    return null
  }

  return [left, right]
}

export function normalizeFullNotation(value: unknown): FullNotation | null {
  if (value == null) {
    return null
  }

  if (!Array.isArray(value)) {
    return null
  }

  const normalized: FullNotation = []

  for (const [index, rawEntry] of value.entries()) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return null
    }

    const entry = rawEntry as Record<string, unknown>
    const placement = isPlacement(entry.placement)
      ? entry.placement
      : isPlacement(entry.position)
        ? entry.position
        : null
    const arcs = normalizeArcPair(entry.arcs) ?? normalizeArcPair(entry.edges)
    const crossingId = toFiniteNumber(entry.crossing_id)
    const strandId = toFiniteNumber(entry.strand_id) ?? index

    if (placement == null || arcs == null || crossingId == null) {
      return null
    }

    normalized.push({
      ...entry,
      strand_id: strandId,
      placement,
      position: placement,
      arcs,
      edges: [...arcs] as [number, number],
      crossing_id: crossingId,
    } as FullNotationLine)
  }

  return normalized
}

export function cloneFullNotation(fullNotation: FullNotation): FullNotation {
  return fullNotation.map((line) => ({
    ...line,
    arcs: [...line.arcs] as [number, number],
    edges: [...(line.edges ?? line.arcs)] as [number, number],
    position: line.placement,
  }))
}
