from pathlib import Path
import json
import os

from spherogram import Link
from spherogram.links.orthogonal import OrthogonalLinkDiagram
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 500
ARCHIVE_SCHEMA = "archive"
ARCHIVE_TABLE = "knot_diagrams_old"
ARCHIVE_ID_FIELD = "knot_id"
ARCHIVE_PD_FIELD = "pd_notation"
SOURCE_SCHEMA = "public"
SOURCE_TABLE = "knots"
SOURCE_NAME_FIELD = "name"
SOURCE_ID_FIELD = "id"
TARGET_ID_FIELD = "id"
TARGET_SCHEMA = "public"
TARGET_TABLE = "diagrams_rolf"
KNOT_ID_OFFSET = 13557  # diagrams_rolf.id = knot_diagrams_old.knot_id - KNOT_ID_OFFSET
DIAGRAM_IDS_TO_PROCESS = [5423]


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


def parse_pd(pd_input: str | list[list[int]]) -> list[list[int]]:
    return json.loads(pd_input) if isinstance(pd_input, str) else pd_input


def build_drawing_data(pd_notation: str | list[list[int]]) -> dict:
    pd_code = parse_pd(pd_notation)
    link = Link(pd_code)
    diagram = OrthogonalLinkDiagram(link)
    vertex_positions, arrows, crossing_specs = diagram.plink_data()

    return {
        "vertex_positions": [list(point) for point in vertex_positions],
        "arrows": [list(arrow) for arrow in arrows],
        "crossing_specs": [list(spec) for spec in crossing_specs],
    }


def fetch_knots_batch(supabase, start_diagram_id: int) -> list[dict]:
    archive_start_id = start_diagram_id + KNOT_ID_OFFSET
    archive_result = (
        supabase.schema(ARCHIVE_SCHEMA).table(ARCHIVE_TABLE)
        .select(f"{ARCHIVE_ID_FIELD},{ARCHIVE_PD_FIELD}")
        .gte(ARCHIVE_ID_FIELD, archive_start_id)
        .order(ARCHIVE_ID_FIELD)
        .range(0, BATCH_SIZE - 1)
        .execute()
    )
    archive_rows = archive_result.data or []
    if not archive_rows:
        return []

    diagram_ids = [row[ARCHIVE_ID_FIELD] - KNOT_ID_OFFSET for row in archive_rows]

    knot_result = (
        supabase.schema(SOURCE_SCHEMA).table(SOURCE_TABLE)
        .select(f"{SOURCE_ID_FIELD},{SOURCE_NAME_FIELD}")
        .in_(SOURCE_ID_FIELD, diagram_ids)
        .execute()
    )
    knots_by_id = {row[SOURCE_ID_FIELD]: row for row in knot_result.data or []}

    batch = []
    for row in archive_rows:
        diagram_id = row[ARCHIVE_ID_FIELD] - KNOT_ID_OFFSET
        knot = knots_by_id.get(diagram_id, {})
        batch.append(
            {
                TARGET_ID_FIELD: diagram_id,
                SOURCE_NAME_FIELD: knot.get(SOURCE_NAME_FIELD),
                ARCHIVE_PD_FIELD: row.get(ARCHIVE_PD_FIELD),
            }
        )

    return batch


def fetch_knots_by_ids(supabase, diagram_ids: list[int]) -> list[dict]:
    archive_ids = [diagram_id + KNOT_ID_OFFSET for diagram_id in diagram_ids]

    archive_result = (
        supabase.schema(ARCHIVE_SCHEMA).table(ARCHIVE_TABLE)
        .select(f"{ARCHIVE_ID_FIELD},{ARCHIVE_PD_FIELD}")
        .in_(ARCHIVE_ID_FIELD, archive_ids)
        .execute()
    )
    archive_by_diagram_id = {
        row[ARCHIVE_ID_FIELD] - KNOT_ID_OFFSET: row for row in (archive_result.data or [])
    }

    knot_result = (
        supabase.schema(SOURCE_SCHEMA).table(SOURCE_TABLE)
        .select(f"{SOURCE_ID_FIELD},{SOURCE_NAME_FIELD}")
        .in_(SOURCE_ID_FIELD, diagram_ids)
        .execute()
    )
    knots_by_id = {row[SOURCE_ID_FIELD]: row for row in knot_result.data or []}

    knots = []
    for diagram_id in diagram_ids:
        archive_row = archive_by_diagram_id.get(diagram_id, {})
        knot_row = knots_by_id.get(diagram_id, {})
        knots.append(
            {
                TARGET_ID_FIELD: diagram_id,
                SOURCE_NAME_FIELD: knot_row.get(SOURCE_NAME_FIELD),
                ARCHIVE_PD_FIELD: archive_row.get(ARCHIVE_PD_FIELD),
            }
        )

    return knots


def update_knot_drawing_data(
    supabase,
    id: int | str,
    name: str | None,
    vertex_positions,
    arrows,
    crossing_specs,
) -> None:
    supabase.schema(TARGET_SCHEMA).table(TARGET_TABLE).upsert(
        {
            TARGET_ID_FIELD: id,
            "name": name,
            "vertex_positions": json.dumps(vertex_positions) if vertex_positions is not None else None,
            "arrows": json.dumps(arrows) if arrows is not None else None,
            "crossing_specs": json.dumps(crossing_specs) if crossing_specs is not None else None,
        },
        on_conflict=TARGET_ID_FIELD,
    ).execute()


def process_knots(supabase, knots: list[dict]) -> tuple[int, int, int, int]:
    processed = 0
    updated = 0
    skipped = 0
    failed = 0

    for knot in knots:
        processed += 1
        knot_id = knot[SOURCE_ID_FIELD]
        knot_name = knot.get("name")
        pd_notation = knot.get(ARCHIVE_PD_FIELD)

        if not pd_notation:
            try:
                update_knot_drawing_data(supabase, knot_id, knot_name, None, None, None)
            except Exception as exc:
                failed += 1
                print(
                    f"Diagram ID {knot_id}: failed to write null drawing data — "
                    f"{type(exc).__name__}: {exc}"
                )
                continue
            skipped += 1
            print(f"Diagram ID {knot_id}: skipped (no pd_notation)")
            continue

        try:
            drawing_data = build_drawing_data(pd_notation)
        except Exception as exc:
            failed += 1
            print(
                f"Diagram ID {knot_id}: failed to build drawing data — "
                f"{type(exc).__name__}: {exc}"
            )
            continue

        try:
            update_knot_drawing_data(
                supabase,
                knot_id,
                knot_name,
                drawing_data["vertex_positions"],
                drawing_data["arrows"],
                drawing_data["crossing_specs"],
            )
        except Exception as exc:
            failed += 1
            print(
                f"Diagram ID {knot_id}: failed to write drawing data — "
                f"{type(exc).__name__}: {exc}"
            )
            continue

        updated += 1
        print(f"Diagram ID {knot_id}: updated drawing data")

    return processed, updated, skipped, failed


def process_specific_knots(diagram_ids: list[int]) -> None:
    supabase = get_supabase()

    try:
        knots = fetch_knots_by_ids(supabase, diagram_ids)
    except Exception as exc:
        print(f"Failed to fetch requested diagram IDs {diagram_ids}: {type(exc).__name__}: {exc}")
        return

    processed, updated, skipped, failed = process_knots(supabase, knots)

    print(
        f"\nFinished. Processed {processed}, updated {updated}, "
        f"skipped {skipped}, failed {failed}."
    )


def process_all_knots(start_id: int = 1109) -> None:
    supabase = get_supabase()
    processed = 0
    updated = 0
    skipped = 0
    failed = 0
    next_diagram_id = start_id

    while True:
        try:
            knots = fetch_knots_batch(supabase, next_diagram_id)
        except Exception as exc:
            print(
                f"Failed to fetch batch starting at diagram ID {next_diagram_id}: "
                f"{type(exc).__name__}: {exc}"
            )
            print("Aborting.")
            break

        if not knots:
            break

        batch_processed, batch_updated, batch_skipped, batch_failed = process_knots(supabase, knots)
        processed += batch_processed
        updated += batch_updated
        skipped += batch_skipped
        failed += batch_failed
        if updated and updated % 100 == 0:
            print(f"Drawing data updated for {updated} diagrams (last ID: {knots[-1][SOURCE_ID_FIELD]})")

        next_diagram_id = knots[-1][SOURCE_ID_FIELD] + 1

    print(
        f"\nFinished. Processed {processed}, updated {updated}, "
        f"skipped {skipped}, failed {failed}."
    )


def main() -> None:
    process_specific_knots(DIAGRAM_IDS_TO_PROCESS)


if __name__ == "__main__":
    main()
