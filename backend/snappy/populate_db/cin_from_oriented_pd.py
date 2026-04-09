from pathlib import Path
import json
import os

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


def parse_pd(oriented_pd_string: str) -> list[list[int]]:
    return json.loads(oriented_pd_string)


def build_cin_from_oriented_pd(
    oriented_pd: str | list[list[int]],
) -> list[dict]:
    r"""
    Build Crossings Indexed Notation (CIN) from oriented PD notation.

    For each crossing [a, b, c, d, sign]:

        c        b
         \     /
          /   \
        d     a

    Slot 0 = a-d line, edges (a, d)
    Slot 1 = b-c line, edges (b, c)

    Positive crossing (+1): slot 0 = Under, slot 1 = Over
    Negative crossing (-1): slot 0 = Over,  slot 1 = Under
    """
    code = parse_pd(oriented_pd) if isinstance(oriented_pd, str) else oriented_pd

    cin = []
    for crossing_id, (a, b, c, d, sign) in enumerate(code):
        slot0_placement = "Under" if sign == 1 else "Over"
        slot1_placement = "Over" if sign == 1 else "Under"

        cin.append(
            {
                "crossing_id": crossing_id,
                "placement": slot0_placement,
                "slot": 0,
                "edges": (a, d),
                "sign": sign,
            }
        )
        cin.append(
            {
                "crossing_id": crossing_id,
                "placement": slot1_placement,
                "slot": 1,
                "edges": (b, c),
                "sign": sign,
            }
        )

    return cin


def fetch_knots_batch(supabase, start: int) -> list[dict]:
    result = (
        supabase.table("knot_diagrams")
        .select(f"{KNOT_ID_FIELD},oriented_pd_notation")
        .order(KNOT_ID_FIELD)
        .range(start, start + BATCH_SIZE - 1)
        .execute()
    )
    return result.data or []


def update_knot_ci_notation(supabase, knot_id: int, ci_notation: str | None) -> None:
    (
        supabase.table("knot_diagrams")
        .update({"ci_notation": ci_notation})
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
            oriented_pd_notation = knot.get("oriented_pd_notation")

            if not oriented_pd_notation:
                update_knot_ci_notation(supabase, knot_id, None)
                skipped += 1
                print(
                    f"Knot ID {knot_id}: skipped because oriented_pd_notation is missing"
                )
                continue

            try:
                ci_notation = build_cin_from_oriented_pd(oriented_pd_notation)
                serialized_ci_notation = (
                    ci_notation if isinstance(ci_notation, str) else json.dumps(ci_notation)
                )
                update_knot_ci_notation(supabase, knot_id, serialized_ci_notation)
                updated += 1
                print(f"Knot ID {knot_id}: updated CI notation")
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
