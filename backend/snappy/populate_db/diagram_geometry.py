from collections import defaultdict


ROLF_TABLE = "diagrams_rolf"
VERTICES_AND_ARROWS_TABLE = "vertices_and_arrows"
CROSSING_SPECS_TABLE = "crossing_specs"
QUERY_PAGE_SIZE = 1000
DIAGRAM_ID_CHUNK_SIZE = 200


def _coerce_int(value, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be numeric, got boolean {value!r}")

    try:
        numeric_value = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be numeric, got {value!r}") from exc

    return numeric_value


def _coerce_number(value, field_name: str) -> int | float:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be numeric, got boolean {value!r}")

    try:
        numeric_value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be numeric, got {value!r}") from exc

    return int(numeric_value) if numeric_value.is_integer() else numeric_value


def _ensure_dense(values: list, field_name: str, diagram_id: int) -> list:
    missing_indexes = [index for index, value in enumerate(values) if value is None]
    if missing_indexes:
        raise ValueError(
            f"Diagram {diagram_id} has incomplete {field_name} data at indexes "
            f"{missing_indexes}"
        )
    return values


def build_geometry(vertex_and_arrow_rows: list[dict], crossing_spec_rows: list[dict]) -> dict | None:
    if not vertex_and_arrow_rows:
        return None

    diagram_id = _coerce_int(
        vertex_and_arrow_rows[0]["diagram_id"],
        "vertices_and_arrows.diagram_id",
    )
    vertex_positions: list[list[int | float] | None] = []
    arrows: list[list[int] | None] = []
    crossing_specs: list[list[int] | None] = []

    for row in vertex_and_arrow_rows:
        start_point = _coerce_int(row["start_point"], "vertices_and_arrows.start_point")
        end_point = _coerce_int(row["end_point"], "vertices_and_arrows.end_point")
        strand_x = _coerce_number(row["strand_x"], "vertices_and_arrows.strand_x")
        strand_y = _coerce_number(row["strand_y"], "vertices_and_arrows.strand_y")

        while len(vertex_positions) <= start_point:
            vertex_positions.append(None)
            arrows.append(None)

        vertex_positions[start_point] = [strand_x, strand_y]
        arrows[start_point] = [start_point, end_point]

    for row in crossing_spec_rows:
        crossing_id = _coerce_int(row["crossing_id"], "crossing_specs.crossing_id")
        under_line = _coerce_int(row["under_line"], "crossing_specs.under_line")
        over_line = _coerce_int(row["over_line"], "crossing_specs.over_line")

        while len(crossing_specs) <= crossing_id:
            crossing_specs.append(None)

        crossing_specs[crossing_id] = [under_line, over_line, crossing_id]

    return {
        "vertex_positions": _ensure_dense(vertex_positions, "vertex_positions", diagram_id),
        "arrows": _ensure_dense(arrows, "arrows", diagram_id),
        "crossing_specs": _ensure_dense(crossing_specs, "crossing_specs", diagram_id),
    }


def _fetch_rows_for_diagram_ids(
    supabase,
    get_table,
    schema_name: str | None,
    *,
    table_name: str,
    select_fields: str,
    diagram_ids: list[int],
    order_fields: list[str],
) -> list[dict]:
    rows: list[dict] = []

    for chunk_start in range(0, len(diagram_ids), DIAGRAM_ID_CHUNK_SIZE):
        diagram_id_chunk = diagram_ids[chunk_start : chunk_start + DIAGRAM_ID_CHUNK_SIZE]
        page_start = 0

        while True:
            query = (
                get_table(supabase, schema_name, table_name)
                .select(select_fields)
                .in_("diagram_id", diagram_id_chunk)
            )

            for field_name in order_fields:
                query = query.order(field_name)

            result = query.range(page_start, page_start + QUERY_PAGE_SIZE - 1).execute()
            page_rows = result.data or []
            rows.extend(page_rows)

            if len(page_rows) < QUERY_PAGE_SIZE:
                break

            page_start += QUERY_PAGE_SIZE

    return rows


def fetch_geometry_map_for_base_rows(
    supabase,
    get_table,
    schema_name: str | None,
    base_rows: list[dict],
    *,
    base_id_field: str = "id",
) -> dict[int, dict]:
    if not base_rows:
        return {}

    diagram_ids = [
        _coerce_int(row["diagram_id"], f"{ROLF_TABLE}.diagram_id")
        for row in base_rows
        if row.get("diagram_id") is not None
    ]

    if not diagram_ids:
        return {}

    vertex_rows = _fetch_rows_for_diagram_ids(
        supabase,
        get_table,
        schema_name,
        table_name=VERTICES_AND_ARROWS_TABLE,
        select_fields="diagram_id,start_point,end_point,strand_x,strand_y",
        diagram_ids=diagram_ids,
        order_fields=["diagram_id", "start_point"],
    )
    crossing_rows = _fetch_rows_for_diagram_ids(
        supabase,
        get_table,
        schema_name,
        table_name=CROSSING_SPECS_TABLE,
        select_fields="diagram_id,crossing_id,under_line,over_line",
        diagram_ids=diagram_ids,
        order_fields=["diagram_id", "crossing_id"],
    )

    vertices_by_diagram_id: dict[int, list[dict]] = defaultdict(list)
    for row in vertex_rows:
        vertices_by_diagram_id[
            _coerce_int(row["diagram_id"], "vertices_and_arrows.diagram_id")
        ].append(row)

    crossings_by_diagram_id: dict[int, list[dict]] = defaultdict(list)
    for row in crossing_rows:
        crossings_by_diagram_id[
            _coerce_int(row["diagram_id"], "crossing_specs.diagram_id")
        ].append(row)

    geometry_by_base_id = {}
    for base_row in base_rows:
        base_id = _coerce_int(base_row[base_id_field], f"{ROLF_TABLE}.{base_id_field}")
        diagram_id = base_row.get("diagram_id")
        if diagram_id is None:
            continue

        numeric_diagram_id = _coerce_int(diagram_id, f"{ROLF_TABLE}.diagram_id")
        geometry = build_geometry(
            vertices_by_diagram_id.get(numeric_diagram_id, []),
            crossings_by_diagram_id.get(numeric_diagram_id, []),
        )
        if geometry is not None:
            geometry_by_base_id[base_id] = geometry

    return geometry_by_base_id


def fetch_geometry_map_for_ids(
    supabase,
    get_table,
    schema_name: str | None,
    diagram_ids: list[int],
    *,
    base_id_field: str = "id",
) -> dict[int, dict]:
    if not diagram_ids:
        return {}

    base_result = (
        get_table(supabase, schema_name, ROLF_TABLE)
        .select(f"{base_id_field},diagram_id")
        .in_(base_id_field, diagram_ids)
        .execute()
    )
    return fetch_geometry_map_for_base_rows(
        supabase,
        get_table,
        schema_name,
        base_result.data or [],
        base_id_field=base_id_field,
    )


def replace_geometry(
    supabase,
    get_table,
    schema_name: str | None,
    *,
    knot_id: int | str,
    name: str | None,
    vertex_positions,
    arrows,
    crossing_specs,
    base_id_field: str = "id",
) -> None:
    rolf_table = get_table(supabase, schema_name, ROLF_TABLE)
    existing_rows = (
        rolf_table.select(f"{base_id_field},diagram_id")
        .eq(base_id_field, knot_id)
        .limit(1)
        .execute()
        .data
        or []
    )

    if existing_rows:
        row = existing_rows[0]
        diagram_id = _coerce_int(row["diagram_id"], f"{ROLF_TABLE}.diagram_id")
        if name is not None:
            rolf_table.update({"name": name}).eq(base_id_field, knot_id).execute()
    else:
        insert_payload = {base_id_field: knot_id}
        if name is not None:
            insert_payload["name"] = name
        rolf_table.insert(insert_payload).execute()

        created_rows = (
            rolf_table.select(f"{base_id_field},diagram_id")
            .eq(base_id_field, knot_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not created_rows:
            raise RuntimeError(f"Failed to create `{ROLF_TABLE}` row for knot {knot_id}")

        diagram_id = _coerce_int(created_rows[0]["diagram_id"], f"{ROLF_TABLE}.diagram_id")

    get_table(supabase, schema_name, VERTICES_AND_ARROWS_TABLE).delete().eq(
        "diagram_id", diagram_id
    ).execute()
    get_table(supabase, schema_name, CROSSING_SPECS_TABLE).delete().eq(
        "diagram_id", diagram_id
    ).execute()

    if vertex_positions is not None and arrows is not None:
        if len(vertex_positions) != len(arrows):
            raise ValueError(
                f"vertex_positions length {len(vertex_positions)} does not match arrows length {len(arrows)}"
            )

        vertex_arrow_rows = []
        for index, (position, arrow) in enumerate(zip(vertex_positions, arrows)):
            if not isinstance(position, (list, tuple)) or len(position) < 2:
                raise ValueError(f"Invalid vertex position at index {index}: {position!r}")
            if not isinstance(arrow, (list, tuple)) or len(arrow) < 2:
                raise ValueError(f"Invalid arrow at index {index}: {arrow!r}")

            start_point = _coerce_int(arrow[0], f"arrows[{index}][0]")
            end_point = _coerce_int(arrow[1], f"arrows[{index}][1]")
            if start_point != index:
                raise ValueError(
                    f"Expected arrow {index} to start at {index}, got start_point {start_point}"
                )

            vertex_arrow_rows.append(
                {
                    "diagram_id": diagram_id,
                    "start_point": start_point,
                    "end_point": end_point,
                    "strand_x": _coerce_number(
                        position[0], f"vertex_positions[{index}][0]"
                    ),
                    "strand_y": _coerce_number(
                        position[1], f"vertex_positions[{index}][1]"
                    ),
                }
            )

        if vertex_arrow_rows:
            get_table(supabase, schema_name, VERTICES_AND_ARROWS_TABLE).insert(
                vertex_arrow_rows
            ).execute()

    if crossing_specs:
        crossing_rows = []
        for index, spec in enumerate(crossing_specs):
            if not isinstance(spec, (list, tuple)) or len(spec) < 3:
                raise ValueError(f"Invalid crossing spec at index {index}: {spec!r}")

            crossing_id_value = spec[-1]
            if len(spec) >= 4 and isinstance(spec[2], bool):
                crossing_id_value = spec[3]

            crossing_rows.append(
                {
                    "diagram_id": diagram_id,
                    "crossing_id": _coerce_int(
                        crossing_id_value, f"crossing_specs[{index}][-1]"
                    ),
                    "under_line": _coerce_int(spec[0], f"crossing_specs[{index}][0]"),
                    "over_line": _coerce_int(spec[1], f"crossing_specs[{index}][1]"),
                }
            )

        get_table(supabase, schema_name, CROSSING_SPECS_TABLE).insert(crossing_rows).execute()
