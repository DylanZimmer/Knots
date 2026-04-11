from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from spherogram import Link
from spherogram.links.orthogonal import OrthogonalLinkDiagram
import math, json

app = Flask(__name__)
CORS(app)

# ── helpers ──────────────────────────────────────────────────────────────────

def parse_cin(cin_input):
    return json.loads(cin_input) if isinstance(cin_input, str) else cin_input

def build_cin_from_oriented_pd(oriented_pd: str | list[list[int]],) -> list[dict]:
    r"""
    Build Crossings Indexed Notation (CIN) from oriented PD notation.

    For each crossing [a, b, c, d, sign]:

        c        b
         \     /
          /   \
        d     a

    Slot 0 = a-d line, edges (a, d)
    Slot 1 = b-c line, edges (b, c)

    Positive crossing (+1): slot 0 = Under, slot 1 = Over
    Negative crossing (-1): slot 0 = Over,  slot 1 = Under
    """
    code = parse_pd(oriented_pd) if isinstance(oriented_pd, str) else oriented_pd

    cin = []
    for crossing_id, (a, b, c, d, sign) in enumerate(code):
        slot0_placement = "Under" if sign == 1 else "Over"
        slot1_placement = "Over" if sign == 1 else "Under"

        cin.append(
            {
                "crossing_id": crossing_id,
                "placement": slot0_placement,
                "slot": 0,
                "edges": (a, d),
                "sign": sign,
            }
        )
        cin.append(
            {
                "crossing_id": crossing_id,
                "placement": slot1_placement,
                "slot": 1,
                "edges": (b, c),
                "sign": sign,
            }
        )

    return cin

def build_oriented_pd_from_cin(cin: str | list[dict]) -> list[list[int]]:
    r"""
    Rebuild oriented PD notation from Crossings Indexed Notation (CIN).

    This is the inverse of build_cin_from_oriented_pd. Each crossing must
    contribute exactly two CIN entries:

    - slot 0 with edges (a, d)
    - slot 1 with edges (b, c)

    The reconstructed oriented PD crossing is [a, b, c, d, sign].
    """
    cin_entries = parse_cin(cin) if isinstance(cin, str) else cin

    crossings: dict[int, dict] = {}
    for entry in cin_entries:
        crossing_id = entry["crossing_id"]
        slot = entry["slot"]
        edges = entry["edges"]
        sign = entry["sign"]

        if crossing_id not in crossings:
            crossings[crossing_id] = {"sign": sign, "slots": {}}

        crossing = crossings[crossing_id]
        if crossing["sign"] != sign:
            raise ValueError(f"Crossing {crossing_id} has inconsistent signs in CIN")

        if slot in crossing["slots"]:
            raise ValueError(f"Crossing {crossing_id} has duplicate slot {slot} in CIN")

        crossing["slots"][slot] = tuple(edges)

    oriented_pd = []
    for crossing_id in sorted(crossings):
        crossing = crossings[crossing_id]
        slots = crossing["slots"]

        if 0 not in slots or 1 not in slots:
            raise ValueError(f"Crossing {crossing_id} must contain slots 0 and 1")

        a, d = slots[0]
        b, c = slots[1]
        oriented_pd.append([a, b, c, d, crossing["sign"]])

    return oriented_pd

def parse_pd(pd_input):
    return json.loads(pd_input) if isinstance(pd_input, str) else pd_input

def oriented_pd_to_pd(oriented_pd: str | list[list[int]]) -> list[list[int]]:
    code = parse_pd(oriented_pd)
    return [crossing[:4] for crossing in code]

def build_pd_from_cin(cin: str | list[dict]) -> list[list[int]]:
    oriented_pd = build_oriented_pd_from_cin(cin)
    return oriented_pd_to_pd(oriented_pd)

def get_diagram_inputs(data):
    oriented_pd_notation = data.get('oriented_pd_notation')
    if oriented_pd_notation:
        parsed_oriented_pd = parse_pd(oriented_pd_notation)
        pd_notation = oriented_pd_to_pd(parsed_oriented_pd)
        return None, parsed_oriented_pd, pd_notation

    pd_notation = data.get('pd_notation')
    if pd_notation:
        raise ValueError('oriented_pd_notation or ci_notation is required for oriented rendering')

    ci_notation = data.get('ci_notation')
    if ci_notation:
        parsed_ci_notation = parse_cin(ci_notation)
        oriented_pd_notation = build_oriented_pd_from_cin(parsed_ci_notation)
        pd_notation = oriented_pd_to_pd(oriented_pd_notation)
        return parsed_ci_notation, oriented_pd_notation, pd_notation

    raise ValueError('name, pd_notation, or ci_notation is required')

def segment_intersection(start_a, end_a, start_b, end_b):
    ax1,ay1=start_a; ax2,ay2=end_a; bx1,by1=start_b; bx2,by2=end_b
    a_vertical = ax1==ax2; b_vertical = bx1==bx2
    if a_vertical==b_vertical: raise ValueError
    if a_vertical: return ax1,by1
    return bx1,ay1

def segment_direction(start,end):
    return "vertical" if start[0]==end[0] else "horizontal"

def build_svg(vertex_positions, arrows, crossing_specs, knot_name):
    W,H=500,500; MARGIN=60; STROKE=10; GAP_STROKE=18; GAP_HALF=18; FONT=13
    INNER_W=W-2*MARGIN; INNER_H=H-2*MARGIN

    xs=[x for x,_ in vertex_positions]; ys=[y for _,y in vertex_positions]
    min_x,max_x=min(xs),max(xs); min_y,max_y=min(ys),max(ys)
    span_x=max_x-min_x or 1; span_y=max_y-min_y or 1
    scale=min(INNER_W/span_x, INNER_H/span_y)
    offset_x=MARGIN+(INNER_W-span_x*scale)/2
    offset_y=MARGIN+(INNER_H-span_y*scale)/2

    def to_svg(pt):
        x,y=pt
        return (offset_x+(x-min_x)*scale, offset_y+(y-min_y)*scale)

    svg_vertices=[to_svg(p) for p in vertex_positions]

    crossing_points={}
    for under_idx,over_idx,_,label in crossing_specs:
        crossing_points[label]=segment_intersection(
            svg_vertices[arrows[under_idx][0]], svg_vertices[arrows[under_idx][1]],
            svg_vertices[arrows[over_idx][0]],  svg_vertices[arrows[over_idx][1]])

    lines=[
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" style="background:#fafafa;font-family:monospace;">',
        f'<text x="{W//2}" y="22" text-anchor="middle" '
        f'font-size="16" font-weight="bold" fill="#333">{knot_name}</text>',
    ]

    for si, ei in arrows:
        x1,y1=svg_vertices[si]; x2,y2=svg_vertices[ei]
        lines.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

    for under_idx,over_idx,_,label in crossing_specs:
        cx,cy=crossing_points[label]
        us=svg_vertices[arrows[under_idx][0]]; ue=svg_vertices[arrows[under_idx][1]]
        os=svg_vertices[arrows[over_idx][0]];  oe=svg_vertices[arrows[over_idx][1]]
        gap=(cx-GAP_HALF,cy,cx+GAP_HALF,cy) if segment_direction(us,ue)=="horizontal" else (cx,cy-GAP_HALF,cx,cy+GAP_HALF)
        patch=(cx-GAP_HALF,cy,cx+GAP_HALF,cy) if segment_direction(os,oe)=="horizontal" else (cx,cy-GAP_HALF,cx,cy+GAP_HALF)
        lines.append(
            f'<line x1="{gap[0]:.1f}" y1="{gap[1]:.1f}" x2="{gap[2]:.1f}" y2="{gap[3]:.1f}" '
            f'stroke="#fafafa" stroke-width="{GAP_STROKE}" stroke-linecap="round"/>'
        )
        lines.append(
            f'<line x1="{patch[0]:.1f}" y1="{patch[1]:.1f}" x2="{patch[2]:.1f}" y2="{patch[3]:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

        for (s, e) in [(us, ue), (os, oe)]:
            dx = e[0] - s[0]; dy = e[1] - s[1]
            length = (dx**2 + dy**2)**0.5
            ex = cx + GAP_HALF * dx/length
            ey = cy + GAP_HALF * dy/length
            if abs(dx) >= abs(dy):
                orientation_arrow = '▶' if dx >= 0 else '◀'
            else:
                orientation_arrow = '▼' if dy >= 0 else '▲'
            lines.append(
                f'<text x="{ex:.1f}" y="{ey:.1f}" text-anchor="middle" '
                f'dominant-baseline="central" font-size="{FONT*2}" fill="red">'
                f'{orientation_arrow}</text>'
            )

    lines.append('</svg>')
    return '\n'.join(lines)





"""
def segment_intersection(start_a, end_a, start_b, end_b):
    ax1,ay1=start_a; ax2,ay2=end_a; bx1,by1=start_b; bx2,by2=end_b
    a_vertical = ax1==ax2; b_vertical = bx1==bx2
    if a_vertical==b_vertical: raise ValueError
    if a_vertical: return ax1,by1
    return bx1,ay1

def segment_direction(start,end):
    return "vertical" if start[0]==end[0] else "horizontal"

def build_svg(link, knot_name, oriented_pd_code):
    W,H=500,500; MARGIN=60; STROKE=10; GAP_STROKE=18; GAP_HALF=18; FONT=13
    INNER_W=W-2*MARGIN; INNER_H=H-2*MARGIN

    diagram = OrthogonalLinkDiagram(link)
    vertex_positions, arrows, crossing_specs = diagram.plink_data()
    n_arrows = len(arrows)

    crossing_arrow_indices = set()
    for under_idx, over_idx, _, label in crossing_specs:
        crossing_arrow_indices.add(under_idx)
        crossing_arrow_indices.add(over_idx)

    arc_segments = []
    current = []
    for i, (si, ei) in enumerate(arrows):
        current.append((si, ei))
        if i in crossing_arrow_indices:
            arc_segments.append(current)
            current = []
    if current:
        arc_segments[0] = current + arc_segments[0]

    xs=[x for x,_ in vertex_positions]; ys=[y for _,y in vertex_positions]
    min_x,max_x=min(xs),max(xs); min_y,max_y=min(ys),max(ys)
    span_x=max_x-min_x or 1; span_y=max_y-min_y or 1
    scale=min(INNER_W/span_x, INNER_H/span_y)
    offset_x=MARGIN+(INNER_W-span_x*scale)/2
    offset_y=MARGIN+(INNER_H-span_y*scale)/2

    def to_svg(pt):
        x,y=pt
        return (offset_x+(x-min_x)*scale, offset_y+(y-min_y)*scale)

    svg_vertices=[to_svg(p) for p in vertex_positions]

    crossing_points={}
    for under_idx,over_idx,_,label in crossing_specs:
        crossing_points[label]=segment_intersection(
            svg_vertices[arrows[under_idx][0]], svg_vertices[arrows[under_idx][1]],
            svg_vertices[arrows[over_idx][0]],  svg_vertices[arrows[over_idx][1]])

    # For each crossing, get the outgoing segment directions directly from crossing_specs.
    # The segment arriving at crossing is arrows[under_idx] / arrows[over_idx].
    # The segment leaving is the next one in the cycle.
    # This gives exact H or V direction vectors.
    crossing_out_directions = {}  # ci -> (under_out_glyph, over_out_glyph)
    for under_idx, over_idx, _, ci in crossing_specs:
        under_out_si, under_out_ei = arrows[(under_idx + 1) % n_arrows]
        over_out_si,  over_out_ei  = arrows[(over_idx  + 1) % n_arrows]

        def seg_glyph(si, ei):
            x1,y1 = svg_vertices[si]; x2,y2 = svg_vertices[ei]
            dx,dy = x2-x1, y2-y1
            if abs(dx) >= abs(dy):
                return '▶' if dx >= 0 else '◀'
            else:
                return '▼' if dy >= 0 else '▲'

        def seg_dir(si, ei):
            x1,y1 = svg_vertices[si]; x2,y2 = svg_vertices[ei]
            dx,dy = x2-x1, y2-y1
            length = math.sqrt(dx*dx+dy*dy) or 1
            return dx/length, dy/length

        crossing_out_directions[ci] = {
            'under_glyph': seg_glyph(under_out_si, under_out_ei),
            'under_dir':   seg_dir(under_out_si, under_out_ei),
            'over_glyph':  seg_glyph(over_out_si, over_out_ei),
            'over_dir':    seg_dir(over_out_si, over_out_ei),
        }

    # Arc midpoints by walking longer dimension
    arc_midpoints = {}
    for idx, arc in enumerate(arc_segments):
        total_h = sum(abs(vertex_positions[ei][0] - vertex_positions[si][0]) for si,ei in arc)
        total_v = sum(abs(vertex_positions[ei][1] - vertex_positions[si][1]) for si,ei in arc)

        if total_h >= total_v:
            target_h = total_h / 2
            target_v = total_v
        else:
            target_h = total_h
            target_v = total_v / 2

        spent_h = 0.0
        spent_v = 0.0
        mx, my = svg_vertices[arc[0][0]]
        for si, ei in arc:
            x1,y1 = svg_vertices[si]
            x2,y2 = svg_vertices[ei]
            seg_h = abs(x2-x1)
            seg_v = abs(y2-y1)
            if seg_h > 0:
                remaining = target_h - spent_h
                if remaining <= seg_h:
                    t = remaining / seg_h
                    mx = x1 + t*(x2-x1)
                    my = y1
                    spent_h = target_h
                else:
                    spent_h += seg_h
                    mx,my = x2,y2
            else:
                remaining = target_v - spent_v
                if remaining <= seg_v:
                    t = remaining / seg_v
                    mx = x1
                    my = y1 + t*(y2-y1)
                    spent_v = target_v
                else:
                    spent_v += seg_v
                    mx,my = x2,y2

        arc_midpoints[idx] = (mx, my)

    arc_entry_crossing = {}
    arc_exit_crossing = {}
    for ci, crossing in enumerate(oriented_pd_code):
        for pos, arc_id in enumerate(crossing[:4]):
            if pos % 2 == 1:
                arc_entry_crossing[arc_id] = ci
            else:
                arc_exit_crossing[arc_id] = ci

    all_arc_ids = set()
    for crossing in oriented_pd_code:
        for arc_id in crossing[:4]:
            all_arc_ids.add(arc_id)

    lines=[
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" style="background:#fafafa;font-family:monospace;">',
        f'<text x="{W//2}" y="22" text-anchor="middle" '
        f'font-size="16" font-weight="bold" fill="#333">{knot_name}</text>',
    ]

    # Strands
    for si, ei in arrows:
        x1,y1=svg_vertices[si]; x2,y2=svg_vertices[ei]
        lines.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

    # Crossing gaps and patches
    for under_idx,over_idx,_,label in crossing_specs:
        cx,cy=crossing_points[label]
        us=svg_vertices[arrows[under_idx][0]]; ue=svg_vertices[arrows[under_idx][1]]
        os=svg_vertices[arrows[over_idx][0]];  oe=svg_vertices[arrows[over_idx][1]]
        gap=(cx-GAP_HALF,cy,cx+GAP_HALF,cy) if segment_direction(us,ue)=="horizontal" else (cx,cy-GAP_HALF,cx,cy+GAP_HALF)
        patch=(cx-GAP_HALF,cy,cx+GAP_HALF,cy) if segment_direction(os,oe)=="horizontal" else (cx,cy-GAP_HALF,cx,cy+GAP_HALF)
        lines.append(
            f'<line x1="{gap[0]:.1f}" y1="{gap[1]:.1f}" x2="{gap[2]:.1f}" y2="{gap[3]:.1f}" '
            f'stroke="#fafafa" stroke-width="{GAP_STROKE}" stroke-linecap="round"/>'
        )
        lines.append(
            f'<line x1="{patch[0]:.1f}" y1="{patch[1]:.1f}" x2="{patch[2]:.1f}" y2="{patch[3]:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

    # Two orientation glyphs per crossing using exact H/V outgoing directions.
    # [a,b,c,d,sign]: under out = c (always), over out = d if +1, b if -1.
    # under out direction = arrows[(under_idx+1) % n]
    # over out direction  = arrows[(over_idx+1)  % n]
    GLYPH_OFFSET = 32
    for under_idx, over_idx, _, ci in crossing_specs:
        if ci not in crossing_points:
            continue
        cx, cy = crossing_points[ci]
        sign = oriented_pd_code[ci][4]
        dirs = crossing_out_directions[ci]

        # Under strand always uses under_out direction
        under_glyph = dirs['under_glyph']
        udx, udy = dirs['under_dir']
        lines.append(
            f'<text x="{cx + udx*GLYPH_OFFSET:.1f}" y="{cy + udy*GLYPH_OFFSET + 5:.1f}" '
            f'text-anchor="middle" font-size="14" fill="#f0a500" font-weight="bold">{under_glyph}</text>'
        )

        # Over strand direction depends on sign
        # +1: over goes d->b, outgoing is toward b, which is the over_out segment
        # -1: over goes b->d, outgoing is toward d, which is also the over_out segment
        # In both cases the physical outgoing segment is the same — arrows[(over_idx+1)%n]
        # The sign already determined which end is outgoing when the PD code was built
        over_glyph = dirs['over_glyph']
        odx, ody = dirs['over_dir']
        lines.append(
            f'<text x="{cx + odx*GLYPH_OFFSET:.1f}" y="{cy + ody*GLYPH_OFFSET + 5:.1f}" '
            f'text-anchor="middle" font-size="14" fill="#f0a500" font-weight="bold">{over_glyph}</text>'
        )

    # Arc labels at midpoints, offset perpendicular to strand direction
    for arc_id in sorted(all_arc_ids):
        idx = arc_id - 1
        if idx not in arc_midpoints:
            continue
        mx, my = arc_midpoints[idx]
        exit_ci = arc_exit_crossing.get(arc_id)
        entry_ci = arc_entry_crossing.get(arc_id)
        if exit_ci is None or entry_ci is None:
            continue
        x1,y1 = crossing_points[exit_ci]
        x2,y2 = crossing_points[entry_ci]
        dx,dy = x2-x1, y2-y1
        length = math.sqrt(dx*dx+dy*dy) or 1
        dx,dy = dx/length, dy/length
        px,py = -dy, dx
        lx = mx + px*20
        ly = my + py*20
        lines.append(
            f'<text x="{lx:.1f}" y="{ly+5:.1f}" text-anchor="middle" '
            f'font-size="15" font-weight="bold" fill="#e6550d">{arc_id}</text>'
        )

    # Crossing labels — blue=positive, red=negative
    for idx, c in enumerate(link.crossings):
        if idx not in crossing_points:
            continue
        x, y = crossing_points[idx]
        col = "#4575b4" if c.sign == 1 else "#d73027"
        lines.append(
            f'<text x="{x+16:.1f}" y="{y-12:.1f}" text-anchor="middle" '
            f'font-size="{FONT}" font-weight="bold" fill="{col}">c{idx}</text>'
        )

    lines.append('</svg>')
    return '\n'.join(lines)
"""

# ── routes ────────────────────────────────────────────────────────────────────

@app.route('/', methods=['GET'])
def index():
    return jsonify({'status': 'ok', 'message': 'POST /diagram to render a knot'})

@app.route('/diagram', methods=['POST'])
def generate_diagram():
    """
    Expects JSON body:
      { "name": "3_1", "ci_notation": "[...]" }

    Returns SVG as text/svg+xml.
    """
    data = request.get_json(force=True)
    knot_name = data.get('name', 'unknown')

    try:
        _, oriented_pd_code, pd_code = get_diagram_inputs(data)   #Make one of the inputs moves, change below if necessary
        link = Link(pd_code)
        diagram = OrthogonalLinkDiagram(link)
        vertex_positions, arrows, crossing_specs = diagram.plink_data()
        """
        print("oriented_pd_code", oriented_pd_code)
        print("vertex_positions", vertex_positions)
        print("arrows", arrows)
        print("crossing_specs", crossing_specs)
        """
        svg = build_svg(vertex_positions, arrows, crossing_specs, knot_name)
        return Response(svg, mimetype='image/svg+xml')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/debug', methods=['POST'])
def debug_diagram():
    data = request.get_json(force=True)
    knot_name = data.get('name', 'unknown')

    try:
        ci_notation, oriented_pd_notation, pd_notation = get_diagram_inputs(data)
        return jsonify({
            'name': knot_name,
            'ci_notation': ci_notation,
            'oriented_pd_notation': oriented_pd_notation,
            'pd_notation': pd_notation,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(port=5000, debug=True)
