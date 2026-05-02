import argparse
from pathlib import Path
import os

from postgrest.exceptions import APIError
from supabase import create_client
from diagram_geometry import (
    ROLF_TABLE,
    fetch_geometry_map_for_base_rows,
    fetch_geometry_map_for_ids,
)

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 1000
SCHEMA_NAME = "public"
DIAGRAM_TABLE = ROLF_TABLE
DIAGRAM_ID_FIELD = "id"
CROSSINGS_TABLE = "crossing_specs"
DIAGRAM_IDS_TO_PROCESS: list[int] = []
START_AT_DIAGRAM_ROW_ID: int | None = 5614
WRITE_BATCH_SIZE = 500


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
            "This is usually a database configuration issue.\n"
            f"Check that the key in {ENV_PATH} is a secret/service key and that the "
            f"`{schema_label}` schema is exposed to the API and granted to the role behind that key."
        ) from exc
    raise RuntimeError(
        f"Supabase request failed while trying to {action} `{schema_label}.{table_name}`: {details}"
    ) from exc


def segment_intersection_logical(start_a, end_a, start_b, end_b):
    """Intersection of two axis-aligned segments in logical coordinates."""
    ax1, ay1 = start_a
    ax2, ay2 = end_a
    bx1, by1 = start_b
    bx2, by2 = end_b

    a_vertical = ax1 == ax2
    b_vertical = bx1 == bx2

    if a_vertical == b_vertical:
        raise ValueError(f"Segments are parallel: {start_a}-{end_a}, {start_b}-{end_b}")

    if a_vertical:
        return (ax1, by1)
    return (bx1, ay1)


def fetch_batch(supabase, start: int, start_at_diagram_row_id: int | None = None) -> list[dict]:
    try:
        query = (
            get_table(supabase, SCHEMA_NAME, DIAGRAM_TABLE)
            .select(f"{DIAGRAM_ID_FIELD},diagram_id")
            .order(DIAGRAM_ID_FIELD)
        )
        if start_at_diagram_row_id is not None:
            query = query.gte(DIAGRAM_ID_FIELD, start_at_diagram_row_id)

        result = query.range(start, start + BATCH_SIZE - 1).execute()
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="read from",
            schema_name=SCHEMA_NAME,
            table_name=DIAGRAM_TABLE,
        )

    base_rows = result.data or []
    if not base_rows:
        return []

    try:
        geometry_by_id = fetch_geometry_map_for_base_rows(
            supabase,
            get_table,
            SCHEMA_NAME,
            base_rows,
            base_id_field=DIAGRAM_ID_FIELD,
        )
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="read from",
            schema_name=SCHEMA_NAME,
            table_name=DIAGRAM_TABLE,
        )

    combined = []
    for row in base_rows:
        diagram_id = int(row[DIAGRAM_ID_FIELD])
        geometry = geometry_by_id.get(diagram_id)
        combined.append(
            {
                "diagram_id": diagram_id,
                "normalized_diagram_id": row.get("diagram_id"),
                "vertex_positions": geometry.get("vertex_positions") if geometry else None,
                "arrows": geometry.get("arrows") if geometry else None,
                "crossing_specs": geometry.get("crossing_specs") if geometry else None,
            }
        )

    return combined

def fetch_by_ids(supabase, diagram_ids: list[int]) -> list[dict]:
    if not diagram_ids:
        return []

    try:
        result = (
            get_table(supabase, SCHEMA_NAME, DIAGRAM_TABLE)
            .select(f"{DIAGRAM_ID_FIELD},diagram_id")
            .in_(DIAGRAM_ID_FIELD, diagram_ids)
            .execute()
        )
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="read from",
            schema_name=SCHEMA_NAME,
            table_name=DIAGRAM_TABLE,
        )

    try:
        geometry_by_id = fetch_geometry_map_for_ids(
            supabase,
            get_table,
            SCHEMA_NAME,
            diagram_ids,
            base_id_field=DIAGRAM_ID_FIELD,
        )
    except APIError as exc:
        wrap_schema_api_error(
            exc,
            action="read from",
            schema_name=SCHEMA_NAME,
            table_name=DIAGRAM_TABLE,
        )

    base_rows = result.data or []
    base_row_by_id = {
        int(row[DIAGRAM_ID_FIELD]): row
        for row in base_rows
    }

    combined = []
    for diagram_id in diagram_ids:
        row = base_row_by_id.get(diagram_id)
        geometry = geometry_by_id.get(diagram_id)
        combined.append(
            {
                "diagram_id": diagram_id,
                "normalized_diagram_id": row.get("diagram_id") if row else None,
                "vertex_positions": geometry.get("vertex_positions") if geometry else None,
                "arrows": geometry.get("arrows") if geometry else None,
                "crossing_specs": geometry.get("crossing_specs") if geometry else None,
            }
        )

    return combined


def compute_crossing_point_updates(diagram_rows: list[dict]) -> tuple[list[tuple[float, float, int, int]], list[str], int]:
    updates: list[tuple[float, float, int, int]] = []
    errors: list[str] = []
    processed = 0

    for row in diagram_rows:
        diagram_id = int(row["diagram_id"])
        normalized_diagram_id = row.get("normalized_diagram_id")
        vertex_positions = row.get("vertex_positions")
        arrows = row.get("arrows")
        crossing_specs = row.get("crossing_specs")

        if normalized_diagram_id is None:
            errors.append(f"diagram {diagram_id}: missing normalized diagram_id")
            continue

        missing = [
            field_name
            for field_name, value in (
                ("vertex_positions", vertex_positions),
                ("arrows", arrows),
                ("crossing_specs", crossing_specs),
            )
            if not value
        ]
        if missing:
            errors.append(
                f"diagram {diagram_id}: missing geometry data: {', '.join(missing)}"
            )
            continue

        edge_endpoints = {int(start): int(end) for start, end in arrows}
        processed += len(crossing_specs)

        for under_line, over_line, crossing_id in crossing_specs:
            under_line = int(under_line)
            over_line = int(over_line)
            crossing_id = int(crossing_id)

            try:
                u_start = vertex_positions[under_line]
                u_next = edge_endpoints.get(under_line)
                u_end = vertex_positions[u_next] if u_next is not None else None

                o_start = vertex_positions[over_line]
                o_next = edge_endpoints.get(over_line)
                o_end = vertex_positions[o_next] if o_next is not None else None

                if not all([u_start, u_end, o_start, o_end]):
                    errors.append(
                        f"diagram {diagram_id} crossing {crossing_id}: missing vertex data"
                    )
                    continue

                cx, cy = segment_intersection_logical(u_start, u_end, o_start, o_end)
                updates.append((cx, cy, int(normalized_diagram_id), crossing_id))
            except (IndexError, TypeError, ValueError) as exc:
                errors.append(f"diagram {diagram_id} crossing {crossing_id}: {exc}")

    return updates, errors, processed


def write_crossing_point_updates(supabase, updates: list[tuple[float, float, int, int]]) -> int:
    updated = 0
    supports_compound_upsert = True

    for batch_start in range(0, len(updates), WRITE_BATCH_SIZE):
        batch = updates[batch_start : batch_start + WRITE_BATCH_SIZE]

        rows = [
            {
                "diagram_id": diagram_id,
                "crossing_id": crossing_id,
                "crossing_x": crossing_x,
                "crossing_y": crossing_y,
            }
            for crossing_x, crossing_y, diagram_id, crossing_id in batch
        ]

        if supports_compound_upsert:
            try:
                (
                    get_table(supabase, SCHEMA_NAME, CROSSINGS_TABLE)
                    .upsert(rows, on_conflict="diagram_id,crossing_id")
                    .execute()
                )
            except APIError as exc:
                if getattr(exc, "code", None) != "42P10":
                    wrap_schema_api_error(
                        exc,
                        action="update",
                        schema_name=SCHEMA_NAME,
                        table_name=CROSSINGS_TABLE,
                    )

                supports_compound_upsert = False
                print(
                    "  crossing_specs has no unique constraint on "
                    "(diagram_id, crossing_id); falling back to filtered updates."
                )

        if not supports_compound_upsert:
            for row in rows:
                try:
                    (
                        get_table(supabase, SCHEMA_NAME, CROSSINGS_TABLE)
                        .update(
                            {
                                "crossing_x": row["crossing_x"],
                                "crossing_y": row["crossing_y"],
                            }
                        )
                        .eq("diagram_id", row["diagram_id"])
                        .eq("crossing_id", row["crossing_id"])
                        .execute()
                    )
                except APIError as exc:
                    wrap_schema_api_error(
                        exc,
                        action="update",
                        schema_name=SCHEMA_NAME,
                        table_name=CROSSINGS_TABLE,
                    )

        updated += len(batch)
        print(f"  Written {updated} crossing points so far...")

    return updated


def process_diagram_rows(supabase, diagram_rows: list[dict]) -> tuple[int, int]:
    updates, errors, processed = compute_crossing_point_updates(diagram_rows)

    if errors:
        print("Warnings:")
        for error in errors:
            print(f"  {error}")

    updated = write_crossing_point_updates(supabase, updates)
    return processed, updated


def process_all_crossings(start_at_diagram_row_id: int | None = None) -> None:
    supabase = get_supabase()
    processed = 0
    updated = 0
    start = 0

    if start_at_diagram_row_id is not None:
        print(
            f"Starting crossing location population at "
            f"{DIAGRAM_TABLE}.{DIAGRAM_ID_FIELD} >= {start_at_diagram_row_id}."
        )

    while True:
        diagram_rows = fetch_batch(
            supabase,
            start,
            start_at_diagram_row_id=start_at_diagram_row_id,
        )
        if not diagram_rows:
            break

        batch_processed, batch_updated = process_diagram_rows(supabase, diagram_rows)
        processed += batch_processed
        updated += batch_updated
        start += len(diagram_rows)

        print(
            f"Processed {processed} crossing rows so far. "
            f"Updated {updated} crossing points."
        )

    print(f"Finished. Processed {processed} crossing rows, updated {updated} crossing points.")


def process_specific_diagrams(diagram_ids: list[int]) -> None:
    supabase = get_supabase()
    diagram_rows = fetch_by_ids(supabase, diagram_ids)

    if not diagram_rows:
        print(f"No diagram rows found for diagram IDs {diagram_ids}.")
        return

    processed, updated = process_diagram_rows(supabase, diagram_rows)
    print(
        f"Finished requested diagrams {diagram_ids}. "
        f"Processed {processed} crossing rows, updated {updated} crossing points."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Populate crossing_x and crossing_y in crossing_specs from stored diagram geometry."
        )
    )
    parser.add_argument(
        "--start-at",
        type=int,
        default=START_AT_DIAGRAM_ROW_ID,
        help=(
            f"Resume at this {DIAGRAM_TABLE}.{DIAGRAM_ID_FIELD} value "
            "(inclusive). Defaults to processing from the beginning."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if DIAGRAM_IDS_TO_PROCESS:
        diagram_ids = DIAGRAM_IDS_TO_PROCESS
        if args.start_at is not None:
            diagram_ids = [
                diagram_id
                for diagram_id in diagram_ids
                if diagram_id >= args.start_at
            ]

        process_specific_diagrams(diagram_ids)
        return

    process_all_crossings(start_at_diagram_row_id=args.start_at)


if __name__ == '__main__':
    main()
