type vertex = [number, number];
type vertices = vertex[];
type crossing_spec = [in_line: number, out_line: number, boolean, number];
type crossing_specs = crossing_spec[];
export type placement = 'over' | 'under';
type FullNotationEntry = {
  crossing_id: number;
  placement: placement | null;
  edges: [number, number];
  lines: [number, number];
};
type FullNotation = FullNotationEntry[];
type Geometry = [vertices, vertices, crossing_specs];

function make_room() {  //Include whenever I add anything new, push out everything too close

}

function add_twist()

export function add_Reidemeister_to_geometry(vertex_positions: vertex[], arrows: vertex[], crossing_specs: crossing_spec[], knot_in_fn: FullNotation): [vertex[], vertex[], crossing_spec[]] {
    /*
    R1_TWIST
        const twist: FullNotationLine = {
            crossing_id: line_in.crossing_id,
            placement: null,
            edges: [tN1,tN2],
            lines: [new_inline,new_outline]
        }
    */

    //Maybe pre-clean the knot_in_fn to only include the id's that indicate R moves

    for (const { crossing_id: c_id, placement, edges: [edge_in, edge_out], lines: [line_in, line_out], } of knot_in_fn) {

        if (!Number.isInteger(c_id)) { //Right now just twist. Will need a way to differentiate
            
        }
    }

    return [vertex_positions, arrows, crossing_specs];
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
