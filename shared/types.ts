export type Vertex = [number, number]
export type Vertices = Vertex[]

export type CrossingSpec = [crossing_id: number, under_line: number, over_line: number, crossing_x: number, crossing_y: number]
export type CrossingSpecs = CrossingSpec[]

export type Placement = 'over' | 'under'
export type Position = Placement

export interface FullNotationLine {
  strand_id: number;
  placement: Placement;
  arcs: [number, number];
  crossing_id: number;
  edges?: [number, number];
  position?: Placement;
}

export type FullNotationEntry = FullNotationLine
export type FullNotation = FullNotationLine[]

export type Geometry = {
  vertex_positions: Vertices
  arrows: Vertices
  crossing_specs: CrossingSpecs
}

export type VertexAndArrow = {
  start_point: number;
  end_point: number;
  strand_x: number;
  strand_y: number;
}
export type VerticesAndArrows = VertexAndArrow[];
