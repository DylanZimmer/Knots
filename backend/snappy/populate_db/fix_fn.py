from pathlib import Path
import json
import os

from postgrest.exceptions import APIError
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 500
SOURCE_SCHEMA = "public"
SOURCE_TABLE = "diagrams_rolf"
SOURCE_ID_FIELD = "id"
TARGET_SCHEMA = "public"
TARGET_TABLE = "knots"
TARGET_ID_FIELD = "id"


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
    if getattr(exc, "code", None) == "PGRST205":
        raise RuntimeError(
            "Supabase could not find the requested table while trying to "
            f"{action} `{schema_label}.{table_name}`: {details}\n"
            "Check that the table name and schema are correct and that the schema cache is up to date."
        ) from exc
    if getattr(exc, "code", None) == "42501":
        raise RuntimeError(
            "Supabase rejected the request while trying to "
            f"{action} `{schema_label}.{table_name}`: {details}\n"
            "This is usually a database configuration issue, not a conversion problem.\n"
            f"Check that the key in {ENV_PATH} is a secret/service key and that the "
            f"`{schema_label}` schema is exposed to the API and granted to the role behind that key."
        ) from exc
    raise RuntimeError(
        f"Supabase request failed while trying to {action} `{schema_label}.{table_name}`: {details}"
    ) from exc


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _intersect(e1a, e1b, e2a, e2b):
    """Intersection of two axis-aligned segments. Returns (x, y) or None."""
    x1a, y1a = e1a; x1b, y1b = e1b
    x2a, y2a = e2a; x2b, y2b = e2b
    # e1 vertical, e2 horizontal
    if x1a == x1b and y2a == y2b:
        x, y = x1a, y2a
        if min(y1a, y1b) < y < max(y1a, y1b) and min(x2a, x2b) < x < max(x2a, x2b):
            return (x, y)
    # e1 horizontal, e2 vertical
    if y1a == y1b and x2a == x2b:
        x, y = x2a, y1a
        if min(x1a, x1b) < x < max(x1a, x1b) and min(y2a, y2b) < y < max(y2a, y2b):
            return (x, y)
    return None


def _walk_crossings(vertex_positions, arrows, crossing_specs):
    """
    Walk arrows in order. For each edge, collect every crossing_spec whose
    over-edge or under-edge is this edge, sort by distance from the edge's
    start vertex, and emit (point, spec_index, role) tuples.

    Returns a list of (point, spec_idx, role) in traversal order.
    """
    # Pre-compute the crossing point and participating edges for each spec.
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
        # Sort by distance from edge start so multiple crossings on one edge
        # are encountered in the correct order.
        on_edge.sort(key=lambda item: abs(item[0][0] - pa[0]) + abs(item[0][1] - pa[1]))
        encounters.extend(on_edge)

    return encounters


def _find_cyclic_offset(encounters, full_notation):
    """
    Find the cyclic rotation of `encounters` whose position sequence matches
    the position sequence of `full_notation`.
    """
    walk_roles = [e[2] for e in encounters]
    fn_roles = [_get_crossing_role(f) for f in full_notation]
    n = len(walk_roles)
    for offset in range(n):
        if walk_roles[offset:] + walk_roles[:offset] == fn_roles:
            return offset
    raise ValueError(
        f"No cyclic alignment found between diagram traversal and full_notation.\n"
        f"Walk roles: {walk_roles}\n"
        f"FN roles:   {fn_roles}"
    )


# ---------------------------------------------------------------------------
# Core conversion
# ---------------------------------------------------------------------------

def _get_crossing_role(entry: dict) -> str:
    if "placement" in entry:
        return str(entry["placement"]).lower()
    if "position" in entry:
        return str(entry["position"]).lower()
    raise KeyError("placement")


def convert_full_notation(vertex_positions, arrows, crossing_specs, full_notation):
    """
    Reassign each full_notation entry's crossing_id to the physical crossing
    index from crossing_specs while preserving the existing entry shape.

    The stored full_notation may use either:
        {crossing_id, placement, edges, lines}
    or the older:
        {crossing_id, position, arcs, ...}
    """
    encounters = _walk_crossings(vertex_positions, arrows, crossing_specs)

    if len(encounters) != len(full_notation):
        raise ValueError(
            f"Encounter count {len(encounters)} != full_notation length {len(full_notation)}. "
            f"The diagram data and full_notation are inconsistent."
        )

    offset = _find_cyclic_offset(encounters, full_notation)
    rotated = encounters[offset:] + encounters[:offset]

    result = []
    for fn_entry in full_notation:
        k = int(fn_entry["crossing_id"])
        if k < 0 or k >= len(rotated):
            raise ValueError(
                f"crossing_id {k} is out of range for full_notation of length {len(rotated)}"
            )
        point, spec_idx, role = rotated[k]
        entry_role = _get_crossing_role(fn_entry)
        if role != entry_role:
            raise ValueError(
                f"Position mismatch after rotation at crossing_id {k}: "
                f"diagram says '{role}', full_notation says '{entry_role}'"
            )
        updated_entry = dict(fn_entry)
        updated_entry["crossing_id"] = spec_idx
        result.append(updated_entry)

    return result


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


def _parse_full_notation(raw) -> list[dict]:
    return json.loads(raw) if isinstance(raw, str) else raw


# ---------------------------------------------------------------------------
# Database fetch / update
# ---------------------------------------------------------------------------

def fetch_batch(supabase, start: int) -> list[dict]:
    try:
        result = (
            get_table(supabase, SOURCE_SCHEMA, SOURCE_TABLE)
            .select(f"{SOURCE_ID_FIELD},vertex_positions,arrows,crossing_specs")
            .order(SOURCE_ID_FIELD)
            .range(start, start + BATCH_SIZE - 1)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="read from",
            schema_name=SOURCE_SCHEMA,
            table_name=SOURCE_TABLE,
        )

    # Join with the target knots table to get existing full_notation.
    ids = [row[SOURCE_ID_FIELD] for row in result.data or []]
    if not ids:
        return []

    try:
        fn_result = (
            get_table(supabase, TARGET_SCHEMA, TARGET_TABLE)
            .select(f"{TARGET_ID_FIELD},full_notation")
            .in_(TARGET_ID_FIELD, ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="read from",
            schema_name=TARGET_SCHEMA,
            table_name=TARGET_TABLE,
        )

    fn_by_id = {row[TARGET_ID_FIELD]: row["full_notation"] for row in fn_result.data or []}

    combined = []
    for row in result.data:
        combined.append({**row, "full_notation": fn_by_id.get(row[SOURCE_ID_FIELD])})
    return combined


def update_full_notation(supabase, knot_id, full_notation_json: str | None) -> None:
    try:
        (
            get_table(supabase, TARGET_SCHEMA, TARGET_TABLE)
            .update({"full_notation": full_notation_json})
            .eq(TARGET_ID_FIELD, knot_id)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="update",
            schema_name=TARGET_SCHEMA,
            table_name=TARGET_TABLE,
        )


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
            knot_id = row[SOURCE_ID_FIELD]

            if not row.get("full_notation"):
                skipped += 1
                print(f"Knot {knot_id}: skipped (no full_notation)")
                continue

            if not row.get("vertex_positions") or not row.get("arrows") or not row.get("crossing_specs"):
                missing_fields = [
                    field_name
                    for field_name in ("vertex_positions", "arrows", "crossing_specs")
                    if not row.get(field_name)
                ]
                skipped += 1
                print(
                    f"Knot {knot_id}: skipped (missing diagram data: "
                    f"{', '.join(missing_fields)})"
                )
                continue

            try:
                vp = _parse_vertex_positions(row["vertex_positions"])
                arrows = _parse_arrows(row["arrows"])
                specs = _parse_crossing_specs(row["crossing_specs"])
                fn = _parse_full_notation(row["full_notation"])

                new_fn = convert_full_notation(vp, arrows, specs, fn)
                update_full_notation(supabase, knot_id, json.dumps(new_fn))
                updated += 1
                if updated % 500 == 0:
                    print(f"Updated {updated} knots so far...")

            except Exception as exc:
                failed += 1
                print(f"Knot {knot_id}: FAILED — {type(exc).__name__}: {exc}")

        start += len(batch)

    print(
        f"\nDone. Processed {processed}, updated {updated}, "
        f"skipped {skipped}, failed {failed}."
    )


def main() -> None:
    process_all_knots()


if __name__ == "__main__":
    main()
