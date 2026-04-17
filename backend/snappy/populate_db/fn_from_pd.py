from dataclasses import dataclass
from pathlib import Path
from collections import defaultdict
import json
import os

import spherogram
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
BATCH_SIZE = 500
KNOT_DIAGRAM_ID_FIELD = "knot_id"
KNOT_ROW_ID_FIELD = "id"


@dataclass(frozen=True)
class FullNotationRecord:
    crossing_id: int
    placement: str
    edges: tuple[int, int]
    lines: tuple[int, int]

    def to_dict(self) -> dict:
        return {
            "crossing_id": self.crossing_id,
            "placement": self.placement,
            "edges": list(self.edges),
            "lines": list(self.lines),
        }


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


def normalize_pd_code(pd_input: str | list[list[int]]) -> list[list[int]]:
    pd_code = parse_pd(pd_input)

    if not isinstance(pd_code, list):
        raise ValueError(f"PD notation must be a list of crossings, got {type(pd_code).__name__}")

    normalized: list[list[int]] = []
    for crossing_index, crossing in enumerate(pd_code):
        if not isinstance(crossing, (list, tuple)) or len(crossing) != 4:
            raise ValueError(
                "Each PD crossing must be a 4-item list/tuple; "
                f"crossing {crossing_index} is {crossing!r}"
            )

        try:
            normalized.append([int(edge) for edge in crossing])
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Crossing {crossing_index} contains non-numeric edge labels: {crossing!r}"
            ) from exc

    return normalized

def find_line_num_for_in_edge(pd, e):
    for pd_e in pd:
        if pd_e[1] == e:
            return pd_e[3]
        if pd_e[2] == e:
            return pd_e[0]


def pd_to_full_notation(pd_input: str | list[list[int]]) -> list[dict]:

    pd_code = normalize_pd_code(pd_input)

    # Step 1: subtract 1 from every entry
    pd = [[x - 1 for x in crossing] for crossing in pd_code]

    n = len(pd)
    next_label = n  # original labels are 0..2n-1, new ones start here

    counts = defaultdict(int)
    next_label = max(max(crossing) for crossing in pd_code)
    
    mod_pd = []
    
    for crossing in pd_code:
        new_crossing = []
        for x in crossing:
            counts[x] += 1
            if counts[x] == 1:
                new_crossing.append(x)
            else:
                new_crossing.append(next_label + x)
        mod_pd.append(new_crossing)


    c_id = 0

    f_n: list[dict] = []

    for i in range(len(pd_code)):        
        f_n.append(
            FullNotationRecord(
                crossing_id=c_id,
                placement='under',
                edges=[mod_pd[i][0], mod_pd[i][2]],
                lines=[find_line_num_for_in_edge(pd_code, pd_code[i][0]), pd_code[i][2]],
            ).to_dict()
        )
        c_id += 1
        f_n.append(
            FullNotationRecord(
                crossing_id=c_id,
                placement='over',
                edges=[mod_pd[i][3], mod_pd[i][1]],
                lines=[find_line_num_for_in_edge(pd_code, pd_code[i][3]), pd_code[i][1]],
            ).to_dict()
        )
        c_id += 1

    return f_n


def fetch_knots_batch(supabase, start: int) -> list[dict]:
    result = (
        supabase.table("knot_diagrams")
        .select(f"{KNOT_DIAGRAM_ID_FIELD},pd_notation")
        .order(KNOT_DIAGRAM_ID_FIELD)
        .range(start, start + BATCH_SIZE - 1)
        .execute()
    )
    return result.data or []


def update_knot_full_notation(supabase, knot_id: int | str, full_notation: str | None) -> None:
    (
        supabase.table("knots")
        .update({"full_notation": full_notation})
        .eq(KNOT_ROW_ID_FIELD, knot_id)
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
            knot_id = knot[KNOT_DIAGRAM_ID_FIELD]
            pd_notation = knot.get("pd_notation")

            if not pd_notation:
                update_knot_full_notation(supabase, knot_id, None)
                skipped += 1
                print(f"Knot ID {knot_id}: skipped because pd_notation is missing")
                continue

            try:
                full_notation = pd_to_full_notation(pd_notation)
                serialized_full_notation = json.dumps(full_notation)
                update_knot_full_notation(supabase, knot_id, serialized_full_notation)
                updated += 1
                if updated % 500 == 0:
                    print("Full notation in ", updated, " knots")
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
