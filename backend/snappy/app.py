from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from spherogram import Link
from spherogram.links.orthogonal import OrthogonalLinkDiagram
import math
import json

app = Flask(__name__)
CORS(app)

# ── helpers ──────────────────────────────────────────────────────────────────

def parse_pd(pd_string: str) -> list[list[int]]:
    """Parse PD notation stored as '[[1,5,2,4],[3,1,4,6],...]' into a list of lists."""
    return json.loads(pd_string)


def get_crossing_positions(link: Link) -> dict:
    """
    Extract crossing positions from Spherogram's internal layout.
    Spherogram computes a planar layout; we access it via the crossing objects.
    Returns {crossing_label: (x, y)} after normalising to a [0,1] box.
    """
    # Trigger layout computation
    try:
        positions = link.crossing_positions()   # dict: crossing -> (x,y)
    except AttributeError:
        # Fallback: attempt to use the internal face/edge layout
        positions = _fallback_positions(link)

    if not positions:
        return {}

    xs = [p[0] for p in positions.values()]
    ys = [p[1] for p in positions.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max_x - min_x or 1
    span_y = max_y - min_y or 1

    normalised = {}
    for crossing, (x, y) in positions.items():
        nx = (x - min_x) / span_x
        ny = (y - min_y) / span_y
        normalised[crossing] = (nx, ny)

    return normalised


def _fallback_positions(link: Link) -> dict:
    """
    If crossing_positions() is unavailable, distribute crossings in a circle.
    This is purely geometric – the diagram won't look like the canonical one,
    but the labels will be correct.
    """
    crossings = link.crossings
    n = len(crossings)
    positions = {}
    for i, c in enumerate(crossings):
        angle = 2 * math.pi * i / n
        x = math.cos(angle)
        y = math.sin(angle)
        positions[c] = (x, y)
    return positions


def get_orthogonal_layout(link: Link) -> tuple[list[tuple[float, float]], list[tuple[int, int]], list[tuple[int, int, bool, int]]]:
    """
    Build the same orthogonal layout Spherogram uses for Link.view().
    """
    diagram = OrthogonalLinkDiagram(link)
    vertex_positions, arrows, crossings = diagram.plink_data()
    return vertex_positions, arrows, crossings


def segment_intersection(
    start_a: tuple[float, float],
    end_a: tuple[float, float],
    start_b: tuple[float, float],
    end_b: tuple[float, float],
) -> tuple[float, float]:
    """
    Return the intersection point of two orthogonal segments.
    """
    ax1, ay1 = start_a
    ax2, ay2 = end_a
    bx1, by1 = start_b
    bx2, by2 = end_b

    a_vertical = ax1 == ax2
    b_vertical = bx1 == bx2

    if a_vertical == b_vertical:
        raise ValueError("Expected one horizontal and one vertical segment")

    if a_vertical:
        return ax1, by1

    return bx1, ay1


def segment_direction(start: tuple[float, float], end: tuple[float, float]) -> str:
    return "vertical" if start[0] == end[0] else "horizontal"


def build_svg(link: Link, knot_name: str, pd_code: list[list[int]]) -> str:
    """
    Build a labeled SVG from a Spherogram Link object.
    Each crossing gets a numbered label; each arc (edge between crossings in
    the PD code) is labelled by the arc index used in the PD notation.
    """
    W, H = 500, 500
    MARGIN = 60
    INNER_W = W - 2 * MARGIN
    INNER_H = H - 2 * MARGIN
    STROKE = 10
    GAP_STROKE = 18
    GAP_HALF = 18
    FONT = 13

    vertex_positions, arrows, crossing_specs = get_orthogonal_layout(link)

    xs = [x for x, _ in vertex_positions]
    ys = [y for _, y in vertex_positions]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max_x - min_x or 1
    span_y = max_y - min_y or 1
    scale = min(INNER_W / span_x, INNER_H / span_y)
    offset_x = MARGIN + (INNER_W - span_x * scale) / 2
    offset_y = MARGIN + (INNER_H - span_y * scale) / 2

    def to_svg(point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        return (
            offset_x + (x - min_x) * scale,
            offset_y + (y - min_y) * scale,
        )

    svg_vertices = [to_svg(point) for point in vertex_positions]
    crossing_points: dict[int, tuple[float, float]] = {}

    for under_idx, over_idx, _is_virtual, label in crossing_specs:
        under_arrow = arrows[under_idx]
        over_arrow = arrows[over_idx]
        under_start = svg_vertices[under_arrow[0]]
        under_end = svg_vertices[under_arrow[1]]
        over_start = svg_vertices[over_arrow[0]]
        over_end = svg_vertices[over_arrow[1]]
        crossing_points[label] = segment_intersection(
            under_start, under_end, over_start, over_end
        )

    # ── arc midpoints ─────────────────────────────────────────────────────────
    arc_to_crossings: dict[int, list[tuple[float, float]]] = {}
    for crossing_index, strand_tuple in enumerate(pd_code):
        crossing_point = crossing_points.get(crossing_index)
        if crossing_point is None:
            continue

        for arc_id in strand_tuple:
            arc_to_crossings.setdefault(arc_id, []).append(crossing_point)

    arc_midpoints: dict[int, tuple[float, float]] = {}
    for arc_id, involved in arc_to_crossings.items():
        if len(involved) == 2:
            x1, y1 = involved[0]
            x2, y2 = involved[1]
            arc_midpoints[arc_id] = ((x1 + x2) / 2, (y1 + y2) / 2)
        elif len(involved) == 1:
            # self-loop arc – label near the crossing
            x, y = involved[0]
            arc_midpoints[arc_id] = (x + 20, y - 20)

    # ── SVG assembly ──────────────────────────────────────────────────────────
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" style="background:#fafafa;font-family:monospace;">',
        f'<text x="{W//2}" y="22" text-anchor="middle" '
        f'font-size="16" font-weight="bold" fill="#333">{knot_name}</text>',
    ]

    # Draw the full orthogonal strand segments first.
    for start_idx, end_idx in arrows:
        x1, y1 = svg_vertices[start_idx]
        x2, y2 = svg_vertices[end_idx]
        lines.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

    # Carve a gap in the under strand, then redraw the over strand locally.
    for under_idx, over_idx, _is_virtual, label in crossing_specs:
        cx, cy = crossing_points[label]

        under_start = svg_vertices[arrows[under_idx][0]]
        under_end = svg_vertices[arrows[under_idx][1]]
        over_start = svg_vertices[arrows[over_idx][0]]
        over_end = svg_vertices[arrows[over_idx][1]]

        if segment_direction(under_start, under_end) == "horizontal":
            gap_under = (cx - GAP_HALF, cy, cx + GAP_HALF, cy)
        else:
            gap_under = (cx, cy - GAP_HALF, cx, cy + GAP_HALF)

        if segment_direction(over_start, over_end) == "horizontal":
            over_patch = (cx - GAP_HALF, cy, cx + GAP_HALF, cy)
        else:
            over_patch = (cx, cy - GAP_HALF, cx, cy + GAP_HALF)

        lines.append(
            f'<line x1="{gap_under[0]:.1f}" y1="{gap_under[1]:.1f}" '
            f'x2="{gap_under[2]:.1f}" y2="{gap_under[3]:.1f}" '
            f'stroke="#fafafa" stroke-width="{GAP_STROKE}" stroke-linecap="round"/>'
        )
        lines.append(
            f'<line x1="{over_patch[0]:.1f}" y1="{over_patch[1]:.1f}" '
            f'x2="{over_patch[2]:.1f}" y2="{over_patch[3]:.1f}" '
            f'stroke="#1f4f82" stroke-width="{STROKE}" stroke-linecap="round"/>'
        )

    # Draw arc labels
    for arc_id, (mx, my) in arc_midpoints.items():
        lines.append(
            f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="10" fill="#e8f4f8" '
            f'stroke="#6baed6" stroke-width="1.5"/>'
        )
        lines.append(
            f'<text x="{mx:.1f}" y="{my + 4:.1f}" text-anchor="middle" '
            f'font-size="{FONT}" fill="#2166ac">{arc_id}</text>'
        )

    # Draw crossing labels near the actual crossing points.
    for idx, c in enumerate(link.crossings):
        x, y = crossing_points.get(idx, (W / 2, H / 2))
        sign = c.sign   # +1 or -1
        sign_char = "+" if sign == 1 else "−"
        sign_color = "#d73027" if sign == 1 else "#4575b4"

        lines.append(
            f'<circle cx="{x + 16:.1f}" cy="{y - 16:.1f}" r="12" '
            f'fill="white" stroke="{sign_color}" stroke-width="2.5"/>'
        )
        lines.append(
            f'<text x="{x + 16:.1f}" y="{y - 18:.1f}" text-anchor="middle" '
            f'font-size="{FONT}" font-weight="bold" fill="{sign_color}">'
            f'c{idx}</text>'
        )
        lines.append(
            f'<text x="{x + 16:.1f}" y="{y - 7:.1f}" text-anchor="middle" '
            f'font-size="10" fill="#555">{sign_char}</text>'
        )

    # Legend
    legend_y = H - 18
    lines.append(
        f'<text x="10" y="{legend_y}" font-size="11" fill="#888">'
        f'c# = crossing  ·  arc labels from PD notation  ·  '
        f'<tspan fill="#d73027">red=positive</tspan>  '
        f'<tspan fill="#4575b4">blue=negative</tspan></text>'
    )

    lines.append('</svg>')
    return '\n'.join(lines)


# ── routes ────────────────────────────────────────────────────────────────────

@app.route('/diagram', methods=['POST'])
def generate_diagram():
    """
    Expects JSON body:
      { "name": "3_1", "pd_notation": "[[1,5,2,4],[3,1,4,6],[5,3,6,2]]" }

    Returns SVG as text/svg+xml.
    """
    data = request.get_json(force=True)
    knot_name = data.get('name', 'unknown')
    pd_string = data.get('pd_notation', '')

    if not pd_string:
        return jsonify({'error': 'pd_notation is required'}), 400

    try:
        pd_code = parse_pd(pd_string)
        link = Link(pd_code)
        svg = build_svg(link, knot_name, pd_code)
        return Response(svg, mimetype='image/svg+xml')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(port=5000, debug=True)
