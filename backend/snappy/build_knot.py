from pathlib import Path
import json
import os

from spherogram.links.orthogonal import OrthogonalLinkDiagram
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def load_backend_env() -> None:
    if not ENV_PATH.exists():
        return

    for line in ENV_PATH.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def get_supabase():
    load_backend_env()

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise RuntimeError(
            f"Missing Supabase credentials. Expected SUPABASE_URL and "
            f"SUPABASE_SERVICE_ROLE_KEY in {ENV_PATH}."
        )

    return create_client(url, key)


def parse_json_value(value):
    if isinstance(value, str):
        return json.loads(value)

    return value


def normalize_point_pairs(value, field_name):
    parsed = parse_json_value(value)
    if parsed is None:
        return None

    if not isinstance(parsed, list):
        raise ValueError(f"{field_name} must be a JSON array")

    normalized = []
    for entry in parsed:
        if (
            not isinstance(entry, (list, tuple))
            or len(entry) != 2
            or not all(isinstance(item, (int, float)) for item in entry)
        ):
            raise ValueError(f"{field_name} must contain 2-item numeric pairs")

        normalized.append((entry[0], entry[1]))

    return normalized


def normalize_index_pairs(value, field_name):
    parsed = parse_json_value(value)
    if parsed is None:
        return None

    if not isinstance(parsed, list):
        raise ValueError(f"{field_name} must be a JSON array")

    normalized = []
    for entry in parsed:
        if (
            not isinstance(entry, (list, tuple))
            or len(entry) != 2
            or not all(isinstance(item, (int, float)) for item in entry)
        ):
            raise ValueError(f"{field_name} must contain 2-item numeric pairs")

        normalized.append((int(entry[0]), int(entry[1])))

    return normalized


def normalize_crossing_specs(value):
    parsed = parse_json_value(value)
    if parsed is None:
        return None

    if not isinstance(parsed, list):
        raise ValueError("crossing_specs must be a JSON array")

    normalized = []
    for entry in parsed:
        if not isinstance(entry, (list, tuple)) or len(entry) != 4:
            raise ValueError("crossing_specs must contain 4-item entries")

        normalized.append((int(entry[0]), int(entry[1]), entry[2], entry[3]))

    return normalized


def fetch_drawing_data(knot_name):
    supabase = get_supabase()

    for knot_key in ("name",):
        response = (
            supabase.table("diagrams_rolf")
            .select("vertex_positions, arrows, crossing_specs")
            .eq(knot_key, knot_name)
            .execute()
        )

        rows = response.data or []
        if rows:
            return rows[0]

    return None

def segment_intersection(start_a, end_a, start_b, end_b):
    ax1,ay1=start_a; ax2,ay2=end_a; bx1,by1=start_b; bx2,by2=end_b
    a_vertical = ax1==ax2; b_vertical = bx1==bx2
    if a_vertical==b_vertical: raise ValueError
    if a_vertical: return ax1,by1
    return bx1,ay1

def segment_direction(start,end):
    return "vertical" if start[0]==end[0] else "horizontal"

def build_svg(knot_name):
    drawing_data = fetch_drawing_data(knot_name)
    if drawing_data is None:
        raise ValueError(f"No drawing data for '{knot_name}'")

    vertex_positions = normalize_point_pairs(
        drawing_data.get("vertex_positions"),
        "vertex_positions",
    )
    arrows = normalize_index_pairs(
        drawing_data.get("arrows"),
        "arrows",
    )
    crossing_specs = normalize_crossing_specs(drawing_data.get("crossing_specs"))

    if vertex_positions is None or arrows is None or crossing_specs is None:
        raise ValueError(f"Incomplete drawing data for '{knot_name}'")

    W,H=500,500; MARGIN=60; STROKE=10; GAP_STROKE=18; GAP_HALF=18; FONT=13
    VERTEX_RADIUS=4; VERTEX_LABEL_DX=12; VERTEX_LABEL_DY=-12
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

    for idx, (vx, vy) in enumerate(svg_vertices):
        lines.append(
            f'<circle cx="{vx:.1f}" cy="{vy:.1f}" r="{VERTEX_RADIUS}" '
            f'fill="#fafafa" stroke="#8b1e3f" stroke-width="2"/>'
        )
        lines.append(
            f'<text x="{vx+VERTEX_LABEL_DX:.1f}" y="{vy+VERTEX_LABEL_DY:.1f}" '
            f'text-anchor="middle" dominant-baseline="central" font-size="{FONT}" '
            f'font-weight="bold" fill="#8b1e3f" stroke="#fafafa" stroke-width="2" '
            f'paint-order="stroke">V{idx}</text>'
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

    lines.append('</svg>')
    return '\n'.join(lines)
