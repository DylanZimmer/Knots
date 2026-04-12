from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from spherogram import Link
from spherogram.links.orthogonal import OrthogonalLinkDiagram
import json

app = Flask(__name__)
CORS(app)

type Point = tuple[float, float]

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

    CIN entries store only:
    crossing_id, placement, slot, edges
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
            }
        )
        cin.append(
            {
                "crossing_id": crossing_id,
                "placement": slot1_placement,
                "slot": 1,
                "edges": (b, c),
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
    The sign is inferred from the CIN placements:

    - slot 0 Under + slot 1 Over => sign +1
    - slot 0 Over + slot 1 Under => sign -1
    """
    cin_entries = parse_cin(cin) if isinstance(cin, str) else cin

    crossings: dict[int, dict] = {}
    for entry in cin_entries:
        crossing_id = entry["crossing_id"]
        slot = entry["slot"]
        edges = entry["edges"]
        placement = entry["placement"]

        if crossing_id not in crossings:
            crossings[crossing_id] = {"slots": {}, "placements": {}}

        crossing = crossings[crossing_id]
        if slot in crossing["slots"]:
            raise ValueError(f"Crossing {crossing_id} has duplicate slot {slot} in CIN")

        crossing["slots"][slot] = tuple(edges)
        crossing["placements"][slot] = placement

    oriented_pd = []
    for crossing_id in sorted(crossings):
        crossing = crossings[crossing_id]
        slots = crossing["slots"]
        placements = crossing["placements"]

        if 0 not in slots or 1 not in slots:
            raise ValueError(f"Crossing {crossing_id} must contain slots 0 and 1")

        if placements.get(0) == "Under" and placements.get(1) == "Over":
            sign = 1
        elif placements.get(0) == "Over" and placements.get(1) == "Under":
            sign = -1
        else:
            raise ValueError(
                f"Crossing {crossing_id} must use Under/Over placements for slots 0 and 1"
            )

        a, d = slots[0]
        b, c = slots[1]
        oriented_pd.append([a, b, c, d, sign])

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

def midpoint_of_polyline(points: list[Point]) -> tuple[Point, Point]:
    if not points:
        raise ValueError("Polyline must contain at least one point")

    if len(points) == 1:
        return points[0], (1.0, 0.0)

    lengths = []
    total_length = 0.0
    for start, end in zip(points, points[1:]):
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        segment_length = (dx * dx + dy * dy) ** 0.5
        lengths.append(segment_length)
        total_length += segment_length

    if total_length == 0:
        return points[0], (1.0, 0.0)

    halfway = total_length / 2
    traveled = 0.0
    for index, segment_length in enumerate(lengths):
        start = points[index]
        end = points[index + 1]
        if traveled + segment_length >= halfway and segment_length > 0:
            fraction = (halfway - traveled) / segment_length
            position = (
                start[0] + (end[0] - start[0]) * fraction,
                start[1] + (end[1] - start[1]) * fraction,
            )
            tangent = (end[0] - start[0], end[1] - start[1])
            magnitude = (tangent[0] ** 2 + tangent[1] ** 2) ** 0.5 or 1.0
            return position, (tangent[0] / magnitude, tangent[1] / magnitude)
        traveled += segment_length

    start = points[-2]
    end = points[-1]
    tangent = (end[0] - start[0], end[1] - start[1])
    magnitude = (tangent[0] ** 2 + tangent[1] ** 2) ** 0.5 or 1.0
    return points[-1], (tangent[0] / magnitude, tangent[1] / magnitude)

def label_position(points: list[Point], offset: float = 8.0) -> Point:
    position, tangent = midpoint_of_polyline(points)
    return (
        position[0] + -tangent[1] * offset,
        position[1] + tangent[0] * offset,
    )

def orientation_arrow_svg(cx, cy, dx, dy, size=6, color="red"):
    s = size
    if abs(dx) >= abs(dy):
        if dx >= 0:
            pts = f"{cx-s},{cy-s} {cx+s},{cy} {cx-s},{cy+s}"
        else:
            pts = f"{cx+s},{cy-s} {cx-s},{cy} {cx+s},{cy+s}"
    else:
        if dy >= 0:
            pts = f"{cx-s},{cy-s} {cx},{cy+s} {cx+s},{cy-s}"
        else:
            pts = f"{cx-s},{cy+s} {cx},{cy-s} {cx+s},{cy+s}"
    return f'<polygon points="{pts}" fill="{color}"/>'


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
        lines.append(
            f'<text x="{cx+16:.1f}" y="{cy-16:.1f}" text-anchor="middle" '
            f'dominant-baseline="central" font-size="{FONT+4}" font-weight="bold" '
            f'fill="#f0c040" stroke="#fafafa" stroke-width="3" paint-order="stroke">'
            f'C{label}</text>'
        )

        for (s, e) in [(us, ue), (os, oe)]:
            dx = e[0] - s[0]; dy = e[1] - s[1]
            length = (dx**2 + dy**2)**0.5
            ux, uy = dx/length, dy/length
            ex = cx + GAP_HALF * ux
            ey = cy + GAP_HALF * uy
            lines.append(orientation_arrow_svg(ex, ey, dx, dy))
            lx = ex + ux * 16
            ly = ey + uy * 16
            lines.append(
                f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle" '
                f'dominant-baseline="central" font-size="{FONT}" font-weight="bold" '
                f'fill="#333" stroke="#fafafa" stroke-width="2" paint-order="stroke">'
                f'{arc_label}</text>'
            )

    lines.append('</svg>')
    return '\n'.join(lines)

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
