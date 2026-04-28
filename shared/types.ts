export type Vertex = [number, number]
export type Vertices = Vertex[]

export type CrossingSpec = [in_line: number, out_line: number, number]
export type CrossingSpecs = CrossingSpec[]

export type Placement = 'over' | 'under'
export type Position = Placement

export interface FullNotationLine {
  strand_id: number
  placement: Placement
  arcs: [number, number]
  crossing_id: number
  edges?: [number, number]
  position?: Placement
}

export type FullNotationEntry = FullNotationLine
export type FullNotation = FullNotationLine[]

export type Geometry = {
  vertex_positions: Vertices
  arrows: Vertices
  crossing_specs: CrossingSpecs
}
