import type { FullNotation, FullNotationEntry, Geometry } from './types.ts';

/*
Full Notation:

{crossing_id: x; placement: over/under; edges: a,b; lines: u,v}
and edge a is going in, coming out at edge b
u is the line going in at a, v is the line coming out at b
*/

const addOffset = (x: number, offset: number, precision = 3) => {
  return Number((x + offset).toFixed(precision));
};


export function getMoveRouteKey(moveName: string): string {
  return moveName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function flipOrientation(fullNotation: FullNotation): FullNotation {
  return fullNotation.map((line) => ({
    ...line, arcs: [line.arcs[1], line.arcs[0]],
  }))
}

export function mirror(fullNotation: FullNotation): FullNotation {
  return fullNotation.map((line) => ({
    ...line, placement: line.placement === 'over' ? 'under' : 'over',
  }))
}

export function Smooth(fullNotation: FullNotation): FullNotation {
  //Remove all Reidemeister moves to reveal the prime knot or prime links
  return fullNotation;
}

export const movesNoArgument: Record<string, (fullNotation: FullNotation) => FullNotation> = {
  'Flip Orientation': flipOrientation,
  'Mirror': mirror
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


export function R1_Twist(line: [number, number], twistNum: number, twistType: number): FullNotation {
  /*
      twistType will be 0/1
    If twistType is 0 the line coming from a is the overstrand
    If twistType is 1 the line coming from a is the understrand
      twistNum will be .1, .2, ...
      line given as in, out in current orientation
         --
        /  \
        \  /
        c  d          c = b+.01, d = a+.01
         \/
         /\
        a  b          a = x+.1, b = y+.1
       /    \
      x      y        x & y remain unchanged

  */
  const a = addOffset(line[0], .1)
  const b = addOffset(line[1], .1)
  const twist0: FullNotationEntry = {
    strand_id: twistNum,
    placement: twistType === 0 ? 'over' : 'under',
    arcs: [a, addOffset(a,.01)],
    crossing_id: twistNum
  };
  const twist1: FullNotationEntry = {
    strand_id: twistNum,
    placement: twistType === 1 ? 'over' : 'under',
    arcs: [addOffset(b,.01), b],
    crossing_id: twistNum
  }
  const twists: FullNotation = [twist0, twist1]
  return twists;
}

export function getTwistLineOptions(_fullNotation: FullNotation): number[] {
  //Should always be every line, even the ones that are already twisted. So just unique instances of lines in the FullNotation
  const lines: number[] = []
  return lines
}

//To represent a line I need the lines of f_n that go in and come out of it
//I need both pairs that go with each line and I'm going to be adding two lines to the f_n
//(OLD) cross_11 : {c_id11, pa, edges: a,b, lines: u,v}
//(OLD) cross_12 : {c_id12, pb, edges: b,c, lines: v,w}
//(OLD) cross_21 : {c_id21, pc, edges: n,m, lines: t,s}
//(OLD) cross_22 : {c_id22, pd, edges: m,r, lines: s,q}
//(NEW) cross_11 : {c_id11, pa, edges: a,b, lines: u,v}
//(NEW) cross_12 : {c_id12, pb, edges: b,c, lines: v,w}
//(NEW) cross_21 : {c_id21, pc, edges: n,m, lines: t,s}
//(NEW) cross_22 : {c_id22, pd, edges: m,r, lines: s,q}
//      Below are new additions to f_lines
//I think I do need to do placement but I don't see how
//(NEW) cross_0  : {c_id0, p?, s?, edges: }

export function R2_poke(f_lines: FullNotation): FullNotation {
  //Add two FullNotation lines.
  return f_lines
}

export function getPokeLineOptions(_f_lines: FullNotation): number[] {
  const lines: number[] = []
  return lines
}

export function R3_push(f_lines: FullNotation): FullNotation {
    return f_lines
}

export function getPushLineOptions(_fullNotation: FullNotation): number[] {
  const lines: number[] = []
  return lines;
}
