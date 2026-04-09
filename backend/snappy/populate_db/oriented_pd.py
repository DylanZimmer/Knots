from pathlib import Path
import json
import os

import spherogram
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 500
KNOT_ID_FIELD = "knot_id"


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


def parse_pd(pd_string: str) -> list[list[int]]:
    return json.loads(pd_string)


def pd_to_oriented_pd(pd: str | list[list[int]]) -> list[list[int]]:
    pd_code = parse_pd(pd) if isinstance(pd, str) else pd
    link = spherogram.Link(pd_code)

    oriented_pd = []
    for crossing, spherogram_crossing in zip(
        link.PD_code(min_strand_index=1), link.crossings, strict=True
    ):
        oriented_pd.append([*crossing, spherogram_crossing.sign])

    return oriented_pd


def fetch_knots_batch(supabase, start: int) -> list[dict]:
    result = (
        supabase.table("knot_diagrams")
        .select(f"{KNOT_ID_FIELD},pd_notation")
        .order(KNOT_ID_FIELD)
        .range(start, start + BATCH_SIZE - 1)
        .execute()
    )
    return result.data or []


def update_knot_oriented_pd(supabase, knot_id: int, oriented_pd_notation: str | None) -> None:
    (
        supabase.table("knot_diagrams")
        .update({"oriented_pd_notation": oriented_pd_notation})
        .eq(KNOT_ID_FIELD, knot_id)
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
            knot_id = knot[KNOT_ID_FIELD]
            pd_string = knot.get("pd_notation")

            if not pd_string:
                update_knot_oriented_pd(supabase, knot_id, None)
                skipped += 1
                print(f"Knot ID {knot_id}: skipped because pd_notation is missing")
                continue

            try:
                oriented_pd_notation = json.dumps(pd_to_oriented_pd(pd_string))
                update_knot_oriented_pd(supabase, knot_id, oriented_pd_notation)
                updated += 1
                print(f"Knot ID {knot_id}: updated oriented PD")
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
