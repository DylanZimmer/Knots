from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from spherogram import Link
from spherogram.links.orthogonal import OrthogonalLinkDiagram
import json

app = Flask(__name__)
CORS(app)

Point = tuple[float, float]

# ── helpers ──────────────────────────────────────────────────────────────────

def get_diagram_inputs(data):
    oriented_pd_notation = data.get('oriented_pd_notation')
    if oriented_pd_notation:
        parsed_oriented_pd = parse_pd(oriented_pd_notation)
        pd_notation = oriented_pd_to_pd(parsed_oriented_pd)
        return None, parsed_oriented_pd, pd_notation

    pd_notation = data.get('pd_notation')
    if pd_notation:
        raise ValueError('oriented_pd_notation or full_notation is required for oriented rendering')

    full_notation = data.get('full_notation')
    if full_notation is not None:
        parsed_full_notation = parse_cin(full_notation)
        oriented_pd_notation = build_oriented_pd_from_cin(parsed_full_notation)
        pd_notation = oriented_pd_to_pd(oriented_pd_notation)
        return parsed_full_notation, oriented_pd_notation, pd_notation

    raise ValueError('name, pd_notation, or full_notation is required')

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

def normalized_crossing_specs(crossing_specs):
    normalized = []
    for index, spec in enumerate(crossing_specs):
        if not isinstance(spec, (list, tuple)) or len(spec) < 2:
            raise ValueError(
                "Each crossing_spec must contain at least the over and under arrow indexes"
            )

        over_idx, under_idx = spec[0], spec[1]
        label = spec[3] if len(spec) >= 4 else index
        normalized.append((over_idx, under_idx, label))

    return normalized

def build_svg(vertex_positions, arrows, crossing_specs):
    W,H=500,500; MARGIN=60; STROKE=10; GAP_STROKE=18; GAP_HALF=18; FONT=13
    INNER_W=W-2*MARGIN; INNER_H=H-2*MARGIN
    crossings = normalized_crossing_specs(crossing_specs)

    xs=[x for x,_ in vertex_positions]; ys=[y for _,y in vertex_positions]
    min_x,max_x=min(xs),max(xs); min_y,max_y=min(ys),max(ys)
    span_x=max_x-min_x or 1; span_y=max_y-min_y or 1
    scale=min(INNER_W/span_x, INNER_H/span_y)
    offset_x=MARGIN+(INNER_W-span_x*scale)/2
    offset_y=MARGIN+(INNER_H-span_y*scale)/2

    def to_svg(pt):
        x,y=pt
        return (offset_x+(x-min_x)*scale, offset_y+(max_y-y)*scale)
    
    svg_vertices=[to_svg(p) for p in vertex_positions]

    crossing_points={}
    for over_idx, under_idx, label in crossings:
        crossing_points[label]=segment_intersection(
            svg_vertices[arrows[under_idx][0]], svg_vertices[arrows[under_idx][1]],
            svg_vertices[arrows[over_idx][0]],  svg_vertices[arrows[over_idx][1]])

    lines=[
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" style="background:#fafafa;font-family:monospace;">',
        f'<text x="{W//2}" y="22" text-anchor="middle" font-size="16" font-weight="bold" fill="#333"></text>',
    ]

    for si, ei in arrows:
        x1,y1=svg_vertices[si]; x2,y2=svg_vertices[ei]
        lines.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

    for over_idx, under_idx, label in crossings:
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
            if abs(dx) >= abs(dy):
                arc_label = 2 * label
            else:
                arc_label = 2 * label + 1
            lines.append(
                f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle" '
                f'dominant-baseline="central" font-size="{FONT}" font-weight="bold" '
                f'fill="#333" stroke="#fafafa" stroke-width="2" paint-order="stroke"></text>'
            )
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
    data = request.get_json(force=True)
    knot_name = data.get('name', 'unknown')

    try:
        vertex_positions = data.get('vertex_positions')
        arrows = data.get('arrows')
        crossing_specs = data.get('crossing_specs')
        if vertex_positions is not None and arrows is not None and crossing_specs is not None:
            svg = build_svg(vertex_positions, arrows, crossing_specs)
            return Response(svg, mimetype='image/svg+xml')

        _, oriented_pd_code, pd_code = get_diagram_inputs(data)   #Make one of the inputs moves, change below if necessary
        link = Link(pd_code)
        diagram = OrthogonalLinkDiagram(link)
        vertex_positions, arrows, crossing_specs = diagram.plink_data()
        svg = build_svg(vertex_positions, arrows, crossing_specs)
        return Response(svg, mimetype='image/svg+xml')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(port=5000, debug=True)
