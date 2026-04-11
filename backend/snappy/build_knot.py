from spherogram.links.orthogonal import OrthogonalLinkDiagram

def segment_intersection(start_a, end_a, start_b, end_b):
    ax1,ay1=start_a; ax2,ay2=end_a; bx1,by1=start_b; bx2,by2=end_b
    a_vertical = ax1==ax2; b_vertical = bx1==bx2
    if a_vertical==b_vertical: raise ValueError
    if a_vertical: return ax1,by1
    return bx1,ay1

def segment_direction(start,end):
    return "vertical" if start[0]==end[0] else "horizontal"

def build_svg(link, knot_name):
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

    lines.append('</svg>')
    return '\n'.join(lines)