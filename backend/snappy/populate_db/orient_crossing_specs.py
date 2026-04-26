from pathlib import Path
import json
import os

from postgrest.exceptions import APIError
from supabase import create_client


ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
PAGE_SIZE = 1000


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


def ensure_parsed(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


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


def crossing_sign(a_prev: int, b_prev: int, vertex_positions: list, arrows: list) -> int:
    next_v = {a: b for a, b in arrows}
    a_pos = vertex_positions[a_prev]
    a_next = vertex_positions[next_v[a_prev]]
    b_pos = vertex_positions[b_prev]
    b_next = vertex_positions[next_v[b_prev]]
    dir_a = (a_next[0] - a_pos[0], a_next[1] - a_pos[1])
    dir_b = (b_next[0] - b_pos[0], b_next[1] - b_pos[1])
    cross = dir_a[0] * dir_b[1] - dir_a[1] * dir_b[0]
    if cross == 0:
        raise ValueError(
            f"Zero cross product at crossing ({a_prev}, {b_prev}) — strands may be parallel"
        )
    return 1 if cross > 0 else -1


def fetch_all_rows(table) -> list:
    all_rows = []
    offset = 0
    while True:
        response = (
            table.select("id, vertex_positions, arrows, crossing_specs")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data
        all_rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return all_rows


def update_crossing_signs(schema_name: str | None = None, table_name: str = "diagrams_rolf") -> None:
    supabase = get_supabase()
    table = get_table(supabase, schema_name, table_name)

    try:
        rows = fetch_all_rows(table)
    except APIError as exc:
        wrap_schema_api_error(exc, action="read", schema_name=schema_name, table_name=table_name)

    print(f"Fetched {len(rows)} rows from {table_name}")

    skipped = 0
    updated = 0

    for row in rows:
        row_id = row["id"]
        crossing_specs = ensure_parsed(row["crossing_specs"])

        if not crossing_specs or not isinstance(crossing_specs[0][2], bool):
            skipped += 1
            continue

        vertex_positions = ensure_parsed(row["vertex_positions"])
        arrows = ensure_parsed(row["arrows"])

        updated_specs = []
        for spec in crossing_specs:
            a, b, _old_bool, d = spec
            sign = crossing_sign(a, b, vertex_positions, arrows)
            updated_specs.append([a, b, sign, d])

        try:
            table.update({"crossing_specs": json.dumps(updated_specs)}).eq("id", row_id).execute()
        except APIError as exc:
            wrap_schema_api_error(exc, action="update", schema_name=schema_name, table_name=table_name)

        print(f"  Updated row {row_id}: {crossing_specs} -> {updated_specs}")
        updated += 1

    print(f"Done. Updated {updated}, skipped {skipped} (already converted).")


if __name__ == "__main__":
    update_crossing_signs()