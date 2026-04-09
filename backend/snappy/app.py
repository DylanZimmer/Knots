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
    pd_notation = data.get('pd_notation')
    if pd_notation:
        return None, None, parse_pd(pd_notation)

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

def build_svg(link, knot_name, pd_code):
    W,H=500,500; MARGIN=60; STROKE=10; GAP_STROKE=18; GAP_HALF=18; FONT=13
    INNER_W=W-2*MARGIN; INNER_H=H-2*MARGIN

    diagram = OrthogonalLinkDiagram(link)
    vertex_positions, arrows, crossing_specs = diagram.plink_data()

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

    # Arc label positions: midpoint between the two crossings sharing that arc,
    # offset perpendicular by a small amount to avoid sitting on the strand.
    arc_to_crossings = {}
    for ci, crossing in enumerate(pd_code):
        cp = crossing_points.get(ci)
        if cp is None: continue
        for arc_id in crossing[:4]:
            arc_to_crossings.setdefault(arc_id, []).append(cp)

    arc_midpoints = {}
    for arc_id, pts in arc_to_crossings.items():
        if len(pts)==2:
            x1,y1=pts[0]; x2,y2=pts[1]
            mx,my=(x1+x2)/2,(y1+y2)/2
            # Perpendicular offset
            dx,dy=x2-x1,y2-y1
            length=math.sqrt(dx*dx+dy*dy) or 1
            px,py=-dy/length,dx/length  # perpendicular unit vector
            arc_midpoints[arc_id]=(mx+px*15, my+py*15)
        elif len(pts)==1:
            x,y=pts[0]
            arc_midpoints[arc_id]=(x+20,y-20)

    lines=[
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" style="background:#fafafa;font-family:monospace;">',
        f'<text x="{W//2}" y="22" text-anchor="middle" '
        f'font-size="16" font-weight="bold" fill="#333">{knot_name}</text>',
    ]

    for si,ei in arrows:
        x1,y1=svg_vertices[si]; x2,y2=svg_vertices[ei]
        lines.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>')

    for under_idx,over_idx,_,label in crossing_specs:
        cx,cy=crossing_points[label]
        us=svg_vertices[arrows[under_idx][0]]; ue=svg_vertices[arrows[under_idx][1]]
        os=svg_vertices[arrows[over_idx][0]];  oe=svg_vertices[arrows[over_idx][1]]
        gap=(cx-GAP_HALF,cy,cx+GAP_HALF,cy) if segment_direction(us,ue)=="horizontal" else (cx,cy-GAP_HALF,cx,cy+GAP_HALF)
        patch=(cx-GAP_HALF,cy,cx+GAP_HALF,cy) if segment_direction(os,oe)=="horizontal" else (cx,cy-GAP_HALF,cx,cy+GAP_HALF)
        lines.append(f'<line x1="{gap[0]:.1f}" y1="{gap[1]:.1f}" x2="{gap[2]:.1f}" y2="{gap[3]:.1f}" stroke="#fafafa" stroke-width="{GAP_STROKE}" stroke-linecap="round"/>')
        lines.append(f'<line x1="{patch[0]:.1f}" y1="{patch[1]:.1f}" x2="{patch[2]:.1f}" y2="{patch[3]:.1f}" stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>')

    for arc_id,(mx,my) in arc_midpoints.items():
        lines.append(f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="10" fill="#e8f4f8" stroke="#6baed6" stroke-width="1.5"/>')
        lines.append(f'<text x="{mx:.1f}" y="{my+4:.1f}" text-anchor="middle" font-size="{FONT}" fill="#2166ac">{arc_id}</text>')

    for idx,c in enumerate(link.crossings):
        x,y=crossing_points.get(idx,(W/2,H/2))
        sign=c.sign; sc="+" if sign==1 else "−"; col="#d73027" if sign==1 else "#4575b4"
        lines.append(f'<circle cx="{x+16:.1f}" cy="{y-16:.1f}" r="12" fill="white" stroke="{col}" stroke-width="2.5"/>')
        lines.append(f'<text x="{x+16:.1f}" y="{y-18:.1f}" text-anchor="middle" font-size="{FONT}" font-weight="bold" fill="{col}">c{idx}</text>')
        lines.append(f'<text x="{x+16:.1f}" y="{y-7:.1f}" text-anchor="middle" font-size="10" fill="#555">{sc}</text>')

    lines.append(f'<text x="10" y="{H-18}" font-size="11" fill="#888">c# = crossing · arc labels from PD notation · <tspan fill="#d73027">red=positive</tspan> <tspan fill="#4575b4">blue=negative</tspan></text>')
    lines.append('</svg>')
    return '\n'.join(lines)

def draw_knot_from_pd(pd_notation, knot_name="Knot", output_path=None):
    pd_code=parse_pd(pd_notation)
    link=Link(pd_code)
    svg=build_svg(link,knot_name,pd_code)
    if output_path:
        with open(output_path,'w') as f: f.write(svg)
    return svg


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
        _, _, pd_code = get_diagram_inputs(data)
        link = Link(pd_code)
        svg = build_svg(link, knot_name, pd_code)
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
