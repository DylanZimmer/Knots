/*
Full Notation :

{crossing_id: x; placement: over/under; slot: 0/1; edges: a,b; lines: u,v}
                              /                  \
Where slot 0 corresponds to  /     and slot 1 to  \
                            /                      \
and edge a is going in, coming out at edge b
u is the line going in at a, v is the line coming out at b
*/

type Placement = "over" | "under";
type Slot = 0 | 1;

interface FLine {
    crossing_id: number;
    placement: Placement | null;
    slot: Slot | null;
    edges: [number, number]; // [in, out]
    lines: [number, number];
}


function flipOrientation(f_lines: FLine[]): FLine[] {
    return f_lines.map(line => ({
        ...line, edges: [line.edges[1], line.edges[0]]
    }));
}

function createMirror(f_lines: FLine[]): FLine[] {
    return f_lines.map(line => ({
        ...line, placement: line.placement === "over" ? "under" : "over"
    }))
}

//(OLD) line_in  : {c_id1, p1, s1, edges: a,b, lines: u,v}
//(OLD) line_out : {c_id2, p2, s2, edges: b,c, lines: v,k}
//         tNum = twistNum * .1
//      tN1 = tNum * 2 + .1        tN2 = tNum * 2 + .2
//(NEW) line_in  : {c_id1, p1, s1, edges: a,b, lines: u,int(v)+tN1} 
//(NEW) line_out : {c_id2, p2, s2, edges: b,c, lines: int(v)+tN2,k}
//(NEW) new_line : {int(c_id1)+tNum, null, null, edges: tN1,tN2, lines: int(v)+tN1, int(v)+tN2 }
    //edges need to be new. Naming them as such allows me to not change existing edges
    //Label the self-loop of the twist by its twistNum, maybe like 'ttwistNum'

function R1_twist(line_in: FLine, line_out: FLine, twistNum: number): FLine[] {
    //A twist will add one line to f_lines, one in one out
    //crossing id : line_x ; x is num twists in that line
    // { c_id, placement: null, slot: null, edges: a,b, lines: u,v }
    /*
             --
            /  \
            \  /
             \/
             /\
            a  b > --- v
            b  a < --- u
    */
    //The twist is in the line coming out of the FLine line
    //There will be on more line to f_lines, and also
        //need to change the edges of both lines containing
    //twistNum is for naming
    const tNum = twistNum * .1;
    const tN1 = (tNum * 2) + .1;
    const tN2 = (tNum * 2) + .2;
    const new_inline  = Math.floor(line_in.lines[1]) + tN1
    const new_outline = Math.floor(line_in.lines[1]) + tN2
    const twist: FLine = {
        crossing_id: line_in.crossing_id,
        placement: null,
        slot: null,
        edges: [tN1,tN2],
        lines: [new_inline,new_outline]
    }
    line_in.lines[1] = new_inline;
    line_out.lines[0] = new_outline;
    const f_lines: FLine[] = [line_in, twist, line_out]
    return f_lines;
}

//To represent a line I need the lines of f_n that go in and come out of it
//I need both pairs that go with each line and I'm going to be adding two lines to the f_n
//(OLD) cross_11 : {c_id11, pa, sa, edges: a,b, lines: u,v}
//(OLD) cross_12 : {c_id12, pb, sb, edges: b,c, lines: v,w}
//(OLD) cross_21 : {c_id21, pc, sc, edges: n,m, lines: t,s}
//(OLD) cross_22 : {c_id22, pd, sd, edges: m,r, lines: s,q}
//(NEW) cross_11 : {c_id11, pa, sa, edges: a,b, lines: u,v}
//(NEW) cross_12 : {c_id12, pb, sb, edges: b,c, lines: v,w}
//(NEW) cross_21 : {c_id21, pc, sc, edges: n,m, lines: t,s}
//(NEW) cross_22 : {c_id22, pd, sd, edges: m,r, lines: s,q}
//      Below are new additions to f_lines
//I think I do need to do slot & placement but I don't see how
//(NEW) cross_0  : {c_id0, p?, s?, edges: }

function R2_poke(f_lines: FLine[], ): FLine[] {
    //Add two FLines, 
    return f_lines

)

function R3_push(f_lines: FLine[]): FLine[] {
    return f_lines;
}
