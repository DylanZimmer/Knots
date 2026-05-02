import type { CrossingSpec, CrossingSpecs, FullNotation, Placement, Vertex, Vertices, VertexAndArrow, VerticesAndArrows } from '../shared/types';

function get_polyline_between_crossings(
    cid1: number, placement1: Placement, cid2: number, placement2: Placement,
    crossing_specs: CrossingSpecs, vs_and_as: VerticesAndArrows
): Vertices {

    // Step 1: get strand indices at each crossing
    // CrossingSpec = [crossing_id, under_line, over_line, crossing_x, crossing_y]
    const spec1 = crossing_specs.find(s => s[0] === cid1);
    const spec2 = crossing_specs.find(s => s[0] === cid2);
    if (!spec1 || !spec2) return [];

    const strand1 = placement1 === 'over' ? spec1[2] : spec1[1];
    const strand2 = placement2 === 'over' ? spec2[2] : spec2[1];

    // Build a lookup: start_point -> VertexAndArrow
    const vertexMap = new Map<number, VertexAndArrow>();
    for (const v of vs_and_as) {
        vertexMap.set(v.start_point, v);
    }

    function walkForward(fromStrand: number, toStrand: number): Vertices | null {
        const points: Vertices = [];
        let current = fromStrand;
        const visited = new Set<number>();

        while (true) {
            if (visited.has(current)) return [];
            visited.add(current);

            const vertex = vertexMap.get(current);
            if (!vertex) return [];

            if (vertex.end_point === toStrand) {
                points.push([vertex.strand_x, vertex.strand_y]);
                return points;
            }

            points.push([vertex.strand_x, vertex.strand_y]);
            current = vertex.end_point;
        }
    }

    // Step 2: try walking forward from strand1 to strand2
    let middle = walkForward(strand1, strand2);
    let forward = true;

    // Step 3: if that failed, walk from strand2 to strand1 and reverse
    if (!middle) {
        middle = walkForward(strand2, strand1);
        forward = false;
    }

    if (!middle) return [];

    if (!forward) middle.reverse();

    // Step 4: bookend with the actual crossing points
    const start: Vertex = [spec1[3], spec1[4]];
    const end: Vertex = [spec2[3], spec2[4]];

    return [start, ...middle, end];
}

function midpoint_of_polyline(polyline: Vertices): Vertex {
    function mid(x1: number, x2: number): number {
        const btwn = Math.abs(x1 - x2)
        return (Math.min(x1, x2) + btwn);
    }
    const i = Math.floor(polyline.length / 2);
    let midpoint: Vertex = [mid(polyline[i][0], polyline[i+1][0]), mid(polyline[i][1], polyline[i+1][1])];
    return midpoint;
}

function two_vertices_in_segment(polyline: Vertices): Vertices {
    function pointthree(x1: number, x2: number) {
        const x = Math.min(x1,x2);
        return x + (Math.abs(x1-x2)*.3);
    }
    function pointseven(x1: number, x2: number) {
        const x = Math.min(x1,x2);
        return x + (Math.abs(x1-x2)*.7);
    }
    const i = Math.floor(polyline.length / 2);
    let mid1: Vertex = [pointthree(polyline[i][0], polyline[i+1][0]), pointthree(polyline[i][1], polyline[i+1][1])];
    let mid2: Vertex = [pointseven(polyline[i+1][0], polyline[i][0]), pointseven(polyline[i+1][1], polyline[i][1])];
    return [mid1, mid2];
}

export function add_twist_to_picture(
    cid1: number, placement1: Placement, cid2: number, placement2: Placement,
    crossing_specs: CrossingSpecs, vs_and_as: VerticesAndArrows
): [CrossingSpecs, VerticesAndArrows] {
    let new_crossing_specs = crossing_specs;
    let new_vs_and_as = vs_and_as;
    const polyline = get_polyline_between_crossings(cid1, placement1, cid2, placement2, crossing_specs, vs_and_as);
    if (polyline.length === 0) {
        return [crossing_specs, vs_and_as];
    }
    const new_vertices = two_vertices_in_segment(polyline);
    
    return [new_crossing_specs, new_vs_and_as]
}


export function add_Reidemeister_to_geometry(
  vertex_positions: Vertex[],
  arrows: Vertex[],
  crossing_specs: CrossingSpec[],
  knot_in_fn: FullNotation,
): [Vertex[], Vertex[], CrossingSpec[]] {
    /*
    R1_TWIST
        const twist: FullNotationLine = {
            crossing_id: line_in.crossing_id,
            placement: null,
            edges: [tN1,tN2],
            cid_pair: 
        }
    */

    //Maybe pre-clean the knot_in_fn to only include the id's that indicate R moves

    for (const { strand_id } of knot_in_fn) {
        if (!Number.isInteger(strand_id)) { //just twist at first
        }
    }

    return [vertex_positions, arrows, crossing_specs]
}



//export function R1_twist(vertex_positions: vertex[], arrows: vertex[], crossing_specs: crossing_spec[], line: number) {
    //If the line has one or more segments without vertices (line 0, 4 in trefoil)
    //If it twists around but has no segments without crossings, put it on the first segment
        //This is equivalent to only one segment, so there's only two cases

    /*
        FOR THE TREFOIL
    vertex_positions
    [[10,30],[10,10],[30,10],[30,40],[20,40],[20,20],[40,20],[40,30]]
    arrows
    [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0]]
    crossing_specs
    [[5,2,false,2],[7,4,false,0],[2,7,false,1]]
    
    [{"edges":[1,2],"lines":[6,2],"placement":"under","crossing_id":0},
     {"edges":[4,5],"lines":[3,5],"placement":"over","crossing_id":1},
     {"edges":[3,10],"lines":[2,4],"placement":"under","crossing_id":2},
     {"edges":[6,7],"lines":[5,1],"placement":"over","crossing_id":3},
     {"edges":[11,12],"lines":[4,6],"placement":"under","crossing_id":4},
     {"edges":[8,9],"lines":[1,3],"placement":"over","crossing_id":5}]

    Put a twist in line 0-5
    [{"crossing_id": 0, "placement": "under", "edges": [0, 1], "lines": [5, 1]}, 
     {"crossing_id": 1, "placement": "over", "edges": [3, 4], "lines": [2, 4]}, 
     {"crossing_id": 2, "placement": "under", "edges": [2, 9], "lines": [1, 3]}, 
     {"crossing_id": 3, "placement": "over", "edges": [5, 6], "lines": [4, 0]}, 
     {"crossing_id": 4, "placement": "under", "edges": [10, 11], "lines": [3, 5]}, 
     {"crossing_id": 5, "placement": "over", "edges": [7, 8], "lines": [0, 2]}]
     
     TWIST AT LINE 0-5
    [{"crossing_id": 0, "placement": "under", "edges": [0.1, 1], "lines": [5.1, 1]}, 
     {"crossing_id": 1, "placement": "over", "edges": [3, 4], "lines": [2, 4]}, 
     {"crossing_id": 2, "placement": "under", "edges": [2, 9], "lines": [1, 3]}, 
     {"crossing_id": 3, "placement": "over", "edges": [5, 6], "lines": [4, 0]}, 
     {"crossing_id": 4, "placement": "under", "edges": [10, 11], "lines": [3, 5]}, 
     {"crossing_id": 5, "placement": "over", "edges": [7, 8], "lines": [0, 2]}]
        
     [{"crossing_id": 0, "placement": "under", "edges": [3, 4], "lines": [2, 4]}, {"crossing_id": 1, "placement": "over", "edges": [0, 1], "lines": [1, 1]}, {"crossing_id": 2, "placement": "under", "edges": [7, 7], "lines": [6, 0]}, {"crossing_id": 3, "placement": "over", "edges": [11, 5], "lines": [3, 5]}, {"crossing_id": 4, "placement": "under", "edges": [12, 6], "lines": [null, 6]}, {"crossing_id": 5, "placement": "over", "edges": [10, 2], "lines": [2, 2]}, {"crossing_id": 6, "placement": "under", "edges": [8, 9], "lines": [null, 2]}, {"crossing_id": 7, "placement": "over", "edges": [14, 13], "lines": [6, 6]}]
    [{"crossing_id": 0, "placement": "under", "edges": [3, 4], "lines": [null, 4]}, {"crossing_id": 1, "placement": "over", "edges": [0, 1], "lines": [7, 1]}, {"crossing_id": 2, "placement": "under", "edges": [7, 7], "lines": [null, 0]}, {"crossing_id": 3, "placement": "over", "edges": [11, 5], "lines": [3, 5]}, {"crossing_id": 4, "placement": "under", "edges": [12, 6], "lines": [4, 6]}, {"crossing_id": 5, "placement": "over", "edges": [10, 2], "lines": [null, 2]}, {"crossing_id": 6, "placement": "under", "edges": [8, 9], "lines": [0, 2]}, {"crossing_id": 7, "placement": "over", "edges": [14, 13], "lines": [null, 6]}]
    [{"crossing_id": 0, "placement": "under", "edges": [3, 4], "lines": [2, 4]}, {"crossing_id": 1, "placement": "over", "edges": [0, 1], "lines": [1, 1]}, {"crossing_id": 2, "placement": "under", "edges": [7, 7], "lines": [6, 0]}, {"crossing_id": 3, "placement": "over", "edges": [11, 5], "lines": [3, 5]}, {"crossing_id": 4, "placement": "under", "edges": [12, 6], "lines": [null, 6]}, {"crossing_id": 5, "placement": "over", "edges": [10, 2], "lines": [2, 2]}, {"crossing_id": 6, "placement": "under", "edges": [8, 9], "lines": [null, 2]}, {"crossing_id": 7, "placement": "over", "edges": [14, 13], "lines": [6, 6]}]
    
    
    [{"crossing_id": 0, "placement": "under", "edges": [2, 3], "lines": [3, 4]}, {"crossing_id": 1, "placement": "over", "edges": [-1, 0], "lines": [7, 1]}, {"crossing_id": 2, "placement": "under", "edges": [6, 5], "lines": [7, 0]}, {"crossing_id": 3, "placement": "over", "edges": [9, 4], "lines": [3, 5]}, {"crossing_id": 4, "placement": "under", "edges": [10, 5], "lines": [4, 6]}, {"crossing_id": 5, "placement": "over", "edges": [8, 1], "lines": [3, 2]}, {"crossing_id": 6, "placement": "under", "edges": [6, 7], "lines": [0, 2]}, {"crossing_id": 7, "placement": "over", "edges": [12, 11], "lines": [7, 6]}]
    [{"crossing_id": 0, "placement": "under", "edges": [3, 4], "lines": [3, 4]}, {"crossing_id": 1, "placement": "over", "edges": [0, 1], "lines": [7, 1]}, {"crossing_id": 2, "placement": "under", "edges": [7, 7], "lines": [7, 0]}, {"crossing_id": 3, "placement": "over", "edges": [11, 5], "lines": [3, 5]}, {"crossing_id": 4, "placement": "under", "edges": [12, 6], "lines": [4, 6]}, {"crossing_id": 5, "placement": "over", "edges": [10, 2], "lines": [3, 2]}, {"crossing_id": 6, "placement": "under", "edges": [8, 9], "lines": [0, 2]}, {"crossing_id": 7, "placement": "over", "edges": [14, 13], "lines": [7, 6]}]
    */
//}
