from pathlib import Path
import json
import os

from postgrest.exceptions import APIError
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 500

# archive.knot_diagrams_old is the source of Gauss notation.
# public.diagrams_rolf is the source of crossing_specs.
# The join key is: diagrams_rolf.id = knot_diagrams_old.knot_id - 13557
GAUSS_SCHEMA = "archive"
GAUSS_TABLE = "knot_diagrams_old"
GAUSS_ID_FIELD = "knot_id"
GAUSS_FIELD = "gauss_notation"

DIAGRAM_SCHEMA = "public"
DIAGRAM_TABLE = "diagrams_rolf"
DIAGRAM_ID_FIELD = "id"

TARGET_SCHEMA = "public"
TARGET_TABLE = "knots"
TARGET_ID_FIELD = "id"

KNOT_ID_OFFSET = 13557  # diagrams_rolf.id = knot_diagrams_old.knot_id - KNOT_ID_OFFSET
DIAGRAM_IDS_TO_PROCESS = [11343]


def load_backend_env() -> None:
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ[key.strip()] = value.strip().strip("'\"")


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


def get_table(supabase, schema_name: str | None, table_name: str):
    if schema_name:
        return supabase.schema(schema_name).table(table_name)
    return supabase.table(table_name)


def wrap_schema_api_error(exc: APIError, *, action: str, schema_name: str | None, table_name: str):
    schema_label = schema_name or "public"
    details = getattr(exc, "message", None) or str(exc)
    if getattr(exc, "code", None) == "42501":
        raise RuntimeError(
            "Supabase rejected the request while trying to "
            f"{action} `{schema_label}.{table_name}`: {details}\n"
            "This is usually a database configuration issue.\n"
            f"Check that the key in {ENV_PATH} is a secret/service key and that the "
            f"`{schema_label}` schema is exposed to the API and granted to the role behind that key."
        ) from exc
    raise RuntimeError(
        f"Supabase request failed while trying to {action} `{schema_label}.{table_name}`: {details}"
    ) from exc


# ---------------------------------------------------------------------------
# Geometry helpers (for matching Gauss crossings to crossing_specs)
# ---------------------------------------------------------------------------

def _intersect(e1a, e1b, e2a, e2b):
    """Intersection of two axis-aligned segments. Returns (x, y) or None."""
    x1a, y1a = e1a; x1b, y1b = e1b
    x2a, y2a = e2a; x2b, y2b = e2b
    if x1a == x1b and y2a == y2b:
        x, y = x1a, y2a
        if min(y1a, y1b) < y < max(y1a, y1b) and min(x2a, x2b) < x < max(x2a, x2b):
            return (x, y)
    if y1a == y1b and x2a == x2b:
        x, y = x2a, y1a
        if min(x1a, x1b) < x < max(x1a, x1b) and min(y2a, y2b) < y < max(y2a, y2b):
            return (x, y)
    return None


def _walk_crossings(vertex_positions, arrows, crossing_specs):
    """
    Walk arrows in order. For each edge, collect every crossing_spec whose
    over-edge or under-edge starts at that edge's start vertex, sort by
    distance from the edge start, and emit (point, spec_index, role) tuples.

    Returns a list of (point, spec_idx, role) in traversal order.
    """
    spec_data = []
    for spec in crossing_specs:
        over_v, under_v = spec[0], spec[1]
        over_edge = next(e for e in arrows if e[0] == over_v)
        under_edge = next(e for e in arrows if e[0] == under_v)
        pt = _intersect(
            vertex_positions[over_edge[0]], vertex_positions[over_edge[1]],
            vertex_positions[under_edge[0]], vertex_positions[under_edge[1]],
        )
        spec_data.append({
            "over_edge": tuple(over_edge),
            "under_edge": tuple(under_edge),
            "point": pt,
        })

    encounters = []
    for edge in arrows:
        edge_t = tuple(edge)
        pa = vertex_positions[edge[0]]
        on_edge = []
        for si, sd in enumerate(spec_data):
            if sd["over_edge"] == edge_t:
                on_edge.append((sd["point"], si, "over"))
            elif sd["under_edge"] == edge_t:
                on_edge.append((sd["point"], si, "under"))
        on_edge.sort(key=lambda item: abs(item[0][0] - pa[0]) + abs(item[0][1] - pa[1]))
        encounters.extend(on_edge)

    return encounters


def _flip_role(role: str) -> str:
    return "under" if role == "over" else "over"


def _match_encounters_to_gauss(encounters, gauss_roles):
    """
    Try forward, reverse, flip, and reverse+flip interpretations of the
    diagram walk against gauss_roles.

    Returns:
        rotated encounters in the matching traversal order
        placement function for converting Gauss signs to standard placements
        conversion label that matched
    """
    candidates = [
        (
            "forward",
            encounters,
            lambda value: "over" if value > 0 else "under",
            [e[2] for e in encounters],
        ),
        (
            "reverse",
            list(reversed(encounters)),
            lambda value: "over" if value > 0 else "under",
            [e[2] for e in reversed(encounters)],
        ),
        (
            "flip",
            encounters,
            lambda value: "under" if value > 0 else "over",
            [_flip_role(e[2]) for e in encounters],
        ),
        (
            "reverse_flip",
            list(reversed(encounters)),
            lambda value: "under" if value > 0 else "over",
            [_flip_role(e[2]) for e in reversed(encounters)],
        ),
    ]

    for conversion_type, ordered_encounters, placement_from_value, walk_roles in candidates:
        n = len(walk_roles)
        for offset in range(n):
            if walk_roles[offset:] + walk_roles[:offset] == gauss_roles:
                rotated = ordered_encounters[offset:] + ordered_encounters[:offset]
                return rotated, placement_from_value, conversion_type

    walk_roles = [e[2] for e in encounters]
    raise ValueError(
        f"No cyclic alignment found between diagram traversal and Gauss notation.\n"
        f"Walk roles: {walk_roles}\n"
        f"Gauss roles: {gauss_roles}"
    )


# ---------------------------------------------------------------------------
# Core conversion
# ---------------------------------------------------------------------------

def gauss_to_full_notation(gauss_input, vertex_positions, arrows, crossing_specs) -> tuple[list[dict], str]:
    """
    Convert a Gauss notation sequence to full notation, with crossing_id
    corresponding to the index in crossing_specs.

    Output fields per entry:
        strand_id   — sequential index of this crossing encounter (0-based)
        placement   — 'over' or 'under'
        arcs        — [strand_id*2, strand_id*2 + 1]
        crossing_id — index into crossing_specs for the physical crossing
    """
    sequence = json.loads(gauss_input) if isinstance(gauss_input, str) else gauss_input

    if not isinstance(sequence, list) or not all(isinstance(v, int) for v in sequence):
        raise ValueError(f"Gauss notation must be a list of integers, got: {sequence!r}")
    if len(sequence) % 2 != 0:
        raise ValueError(
            f"Gauss notation must have an even number of elements, "
            f"got {len(sequence)}: {sequence!r}"
        )

    gauss_roles = ["over" if v > 0 else "under" for v in sequence]

    encounters = _walk_crossings(vertex_positions, arrows, crossing_specs)

    if len(encounters) != len(sequence):
        raise ValueError(
            f"Diagram has {len(encounters)} crossing encounters but Gauss sequence "
            f"has {len(sequence)} entries. Data may be inconsistent."
        )

    rotated, placement_from_value, conversion_type = _match_encounters_to_gauss(encounters, gauss_roles)

    full = []
    for strand_id, (value, (point, spec_idx, role)) in enumerate(zip(sequence, rotated)):
        placement = placement_from_value(value)
        if placement != role:
            raise ValueError(
                f"Matched conversion produced inconsistent placement at strand {strand_id}: "
                f"expected '{role}', got '{placement}'"
            )
        full.append({
            "strand_id": strand_id,
            "placement": placement,
            "arcs": [strand_id * 2, strand_id * 2 + 1],
            "crossing_id": spec_idx,
        })

    return full, conversion_type


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _parse_vertex_positions(raw) -> list[tuple[int, int]]:
    data = json.loads(raw) if isinstance(raw, str) else raw
    return [tuple(p) for p in data]


def _parse_arrows(raw) -> list[tuple[int, int]]:
    data = json.loads(raw) if isinstance(raw, str) else raw
    return [tuple(e) for e in data]


def _parse_crossing_specs(raw) -> list[tuple]:
    data = json.loads(raw) if isinstance(raw, str) else raw
    return [tuple(s) for s in data]


# ---------------------------------------------------------------------------
# Database fetch / update
# ---------------------------------------------------------------------------

def fetch_batch(supabase, start: int) -> list[dict]:
    """
    Fetch a batch of knots joining:
      - archive.knot_diagrams_old  (gauss_notation, keyed by knot_id)
      - public.diagrams_rolf       (vertex_positions, arrows, crossing_specs, keyed by id)
      - public.knots               (full_notation, keyed by id)

    Join: diagrams_rolf.id = knot_diagrams_old.knot_id - KNOT_ID_OFFSET
    """
    try:
        gauss_result = (
            get_table(supabase, GAUSS_SCHEMA, GAUSS_TABLE)
            .select(f"{GAUSS_ID_FIELD},{GAUSS_FIELD}")
            .order(GAUSS_ID_FIELD)
            .range(start, start + BATCH_SIZE - 1)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="read from", schema_name=GAUSS_SCHEMA, table_name=GAUSS_TABLE)

    gauss_rows = gauss_result.data or []
    if not gauss_rows:
        return []

    # Compute diagrams_rolf ids for this batch
    diagram_ids = [row[GAUSS_ID_FIELD] - KNOT_ID_OFFSET for row in gauss_rows]

    try:
        diagram_result = (
            get_table(supabase, DIAGRAM_SCHEMA, DIAGRAM_TABLE)
            .select(f"{DIAGRAM_ID_FIELD},vertex_positions,arrows,crossing_specs")
            .in_(DIAGRAM_ID_FIELD, diagram_ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="read from", schema_name=DIAGRAM_SCHEMA, table_name=DIAGRAM_TABLE)

    try:
        knot_result = (
            get_table(supabase, TARGET_SCHEMA, TARGET_TABLE)
            .select(f"{TARGET_ID_FIELD},full_notation")
            .in_(TARGET_ID_FIELD, diagram_ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="read from", schema_name=TARGET_SCHEMA, table_name=TARGET_TABLE)

    diagram_by_id = {row[DIAGRAM_ID_FIELD]: row for row in diagram_result.data or []}
    knot_by_id = {row[TARGET_ID_FIELD]: row for row in knot_result.data or []}

    combined = []
    for row in gauss_rows:
        diagram_id = row[GAUSS_ID_FIELD] - KNOT_ID_OFFSET
        diagram = diagram_by_id.get(diagram_id)
        knot = knot_by_id.get(diagram_id)
        combined.append({
            "diagram_id": diagram_id,
            "gauss_notation": row.get(GAUSS_FIELD),
            "full_notation": knot.get("full_notation") if knot else None,
            "vertex_positions": diagram.get("vertex_positions") if diagram else None,
            "arrows": diagram.get("arrows") if diagram else None,
            "crossing_specs": diagram.get("crossing_specs") if diagram else None,
        })

    return combined


def fetch_by_ids(supabase, diagram_ids: list[int]) -> list[dict]:
    archive_ids = [diagram_id + KNOT_ID_OFFSET for diagram_id in diagram_ids]

    try:
        gauss_result = (
            get_table(supabase, GAUSS_SCHEMA, GAUSS_TABLE)
            .select(f"{GAUSS_ID_FIELD},{GAUSS_FIELD}")
            .in_(GAUSS_ID_FIELD, archive_ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="read from", schema_name=GAUSS_SCHEMA, table_name=GAUSS_TABLE)

    try:
        diagram_result = (
            get_table(supabase, DIAGRAM_SCHEMA, DIAGRAM_TABLE)
            .select(f"{DIAGRAM_ID_FIELD},vertex_positions,arrows,crossing_specs")
            .in_(DIAGRAM_ID_FIELD, diagram_ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="read from", schema_name=DIAGRAM_SCHEMA, table_name=DIAGRAM_TABLE)

    try:
        knot_result = (
            get_table(supabase, TARGET_SCHEMA, TARGET_TABLE)
            .select(f"{TARGET_ID_FIELD},full_notation")
            .in_(TARGET_ID_FIELD, diagram_ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="read from", schema_name=TARGET_SCHEMA, table_name=TARGET_TABLE)

    gauss_by_diagram_id = {
        row[GAUSS_ID_FIELD] - KNOT_ID_OFFSET: row for row in (gauss_result.data or [])
    }
    diagram_by_id = {row[DIAGRAM_ID_FIELD]: row for row in diagram_result.data or []}
    knot_by_id = {row[TARGET_ID_FIELD]: row for row in knot_result.data or []}

    combined = []
    for diagram_id in diagram_ids:
        gauss = gauss_by_diagram_id.get(diagram_id)
        diagram = diagram_by_id.get(diagram_id)
        knot = knot_by_id.get(diagram_id)
        combined.append({
            "diagram_id": diagram_id,
            "gauss_notation": gauss.get(GAUSS_FIELD) if gauss else None,
            "full_notation": knot.get("full_notation") if knot else None,
            "vertex_positions": diagram.get("vertex_positions") if diagram else None,
            "arrows": diagram.get("arrows") if diagram else None,
            "crossing_specs": diagram.get("crossing_specs") if diagram else None,
        })

    return combined


def update_full_notation(supabase, diagram_id, full_notation_json: str | None, conversion_type: str) -> None:
    try:
        (
            get_table(supabase, TARGET_SCHEMA, TARGET_TABLE)
            .update({"full_notation": full_notation_json})
            .eq(TARGET_ID_FIELD, diagram_id)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="update", schema_name=TARGET_SCHEMA, table_name=TARGET_TABLE)
    try:
        (
            get_table(supabase, DIAGRAM_SCHEMA, DIAGRAM_TABLE)
            .update({"conversion_for_full_notation": conversion_type})
            .eq(DIAGRAM_ID_FIELD, diagram_id)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(exc, action="update", schema_name=DIAGRAM_SCHEMA, table_name=DIAGRAM_TABLE)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def process_all_knots() -> None:
    supabase = get_supabase()
    processed = updated = skipped = failed = 0
    start = 0

    while True:
        batch = fetch_batch(supabase, start)
        if not batch:
            break

        for row in batch:
            processed += 1
            diagram_id = row["diagram_id"]

            if row.get("full_notation"):
                skipped += 1
                #print(f"Diagram {diagram_id}: skipped (full_notation already present)")
                continue

            if not row.get("gauss_notation"):
                skipped += 1
                print(f"Diagram {diagram_id}: skipped (no Gauss notation)")
                continue

            missing = [f for f in ("vertex_positions", "arrows", "crossing_specs") if not row.get(f)]
            if missing:
                skipped += 1
                print(f"Diagram {diagram_id}: skipped (missing diagram data: {', '.join(missing)})")
                continue

            try:
                vp = _parse_vertex_positions(row["vertex_positions"])
                arrows = _parse_arrows(row["arrows"])
                specs = _parse_crossing_specs(row["crossing_specs"])

                full_notation, conversion_type = gauss_to_full_notation(
                    row["gauss_notation"], vp, arrows, specs
                )
                update_full_notation(
                    supabase,
                    diagram_id,
                    json.dumps(full_notation),
                    conversion_type,
                )
                updated += 1
                if updated % 500 == 0:
                    print(f"Updated {updated} knots so far...")

            except Exception as exc:
                failed += 1
                print(f"Diagram {diagram_id}: FAILED — {type(exc).__name__}: {exc}")

        start += len(batch)

    print(
        f"\nDone. Processed {processed}, updated {updated}, "
        f"skipped {skipped}, failed {failed}."
    )


def process_specific_knots(diagram_ids: list[int]) -> None:
    supabase = get_supabase()

    try:
        batch = fetch_by_ids(supabase, diagram_ids)
    except Exception as exc:
        print(f"Failed to fetch requested diagram IDs {diagram_ids}: {type(exc).__name__}: {exc}")
        return

    processed = updated = skipped = failed = 0

    for row in batch:
        processed += 1
        diagram_id = row["diagram_id"]

        if row.get("full_notation"):
            skipped += 1
            print(f"Diagram {diagram_id}: skipped (full_notation already present)")
            continue

        if not row.get("gauss_notation"):
            skipped += 1
            print(f"Diagram {diagram_id}: skipped (no Gauss notation)")
            continue

        missing = [f for f in ("vertex_positions", "arrows", "crossing_specs") if not row.get(f)]
        if missing:
            skipped += 1
            print(f"Diagram {diagram_id}: skipped (missing diagram data: {', '.join(missing)})")
            continue

        try:
            vp = _parse_vertex_positions(row["vertex_positions"])
            arrows = _parse_arrows(row["arrows"])
            specs = _parse_crossing_specs(row["crossing_specs"])

            full_notation, conversion_type = gauss_to_full_notation(
                row["gauss_notation"], vp, arrows, specs
            )
            update_full_notation(
                supabase,
                diagram_id,
                json.dumps(full_notation),
                conversion_type,
            )
            updated += 1
            print(f"Diagram {diagram_id}: updated full_notation ({conversion_type})")

        except Exception as exc:
            failed += 1
            print(f"Diagram {diagram_id}: FAILED — {type(exc).__name__}: {exc}")

    print(
        f"\nDone. Processed {processed}, updated {updated}, "
        f"skipped {skipped}, failed {failed}."
    )


def main() -> None:
    process_specific_knots(DIAGRAM_IDS_TO_PROCESS)


if __name__ == "__main__":
    main()
