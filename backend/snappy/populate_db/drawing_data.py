from pathlib import Path
import json
import os

from spherogram import Link
from spherogram.links.orthogonal import OrthogonalLinkDiagram
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 500
SOURCE_ID_FIELD = "knot_id"
TARGET_ID_FIELD = "id"
SOURCE_TABLE = "knot_diagrams_old"
TARGET_TABLE = "knot_diagrams_rolf"


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


def build_drawing_data(pd_input: str | list[list[int]]) -> dict:
    pd_code = parse_pd(pd_input)
    link = Link(pd_code)
    diagram = OrthogonalLinkDiagram(link)
    vertex_positions, arrows, crossing_specs = diagram.plink_data()

    return {
        "vertex_positions": [list(point) for point in vertex_positions],
        "arrows": [list(arrow) for arrow in arrows],
        "crossing_specs": [list(spec) for spec in crossing_specs],
    }


def fetch_knots_batch(supabase, start: int) -> list[dict]:
    result = (
        supabase.table(SOURCE_TABLE)
        .select(f"{SOURCE_ID_FIELD},pd_notation")
        .order(SOURCE_ID_FIELD)
        .range(start, start + BATCH_SIZE - 1)
        .execute()
    )
    return result.data or []


def update_knot_drawing_data(
    supabase,
    knot_id: int | str,
    vertex_positions,
    arrows,
    crossing_specs,
) -> None:
    (
        supabase.table(TARGET_TABLE)
        .upsert(
            {
                TARGET_ID_FIELD: knot_id,
                "vertex_positions": vertex_positions,
                "arrows": arrows,
                "crossing_specs": crossing_specs,
            },
            on_conflict=TARGET_ID_FIELD,
        )
        .execute()
    )


def process_all_knots() -> None:
    supabase = get_supabase()
    processed = 0
    updated = 0
    skipped = 0
    failed = 0
    start = 0

    while True:
        knots = fetch_knots_batch(supabase, start)
        if not knots:
            break

        for knot in knots:
            processed += 1
            knot_id = knot[SOURCE_ID_FIELD]
            pd_notation = knot.get("pd_notation")

            if not pd_notation:
                update_knot_drawing_data(supabase, knot_id, None, None, None)
                skipped += 1
                print(f"Knot ID {knot_id}: skipped because pd_notation is missing")
                continue

            try:
                drawing_data = build_drawing_data(pd_notation)
                update_knot_drawing_data(
                    supabase,
                    knot_id,
                    drawing_data["vertex_positions"],
                    drawing_data["arrows"],
                    drawing_data["crossing_specs"],
                )
                updated += 1
                if updated % 500 == 0:
                    print("Drawing data updated for ", updated, " knots")
            except Exception as exc:
                failed += 1
                print(f"Knot ID {knot_id}: failed with {type(exc).__name__}: {exc}")

        start += len(knots)

    print(
        f"Finished processing {processed} knots. "
        f"Updated {updated}, skipped {skipped}, failed {failed}."
    )


def main() -> None:
    process_all_knots()


if __name__ == "__main__":
    main()
