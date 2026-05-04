## Table `crossing_specs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `diagram_id` | `int4` |  Nullable |
| `extension` | `int4` |  Nullable |
| `crossing_id` | `int4` |  Nullable |
| `under_line` | `int4` |  Nullable |
| `over_line` | `int4` |  Nullable |
| `crossing_x` | `int4` |  Nullable |
| `crossing_y` | `int4` |  Nullable |

## Table `crossing_specs_rolf`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `diagram_id` | `int4` |  |
| `crossing_id` | `int4` |  |
| `under_line` | `int4` |  |
| `over_line` | `int4` |  |
| `crossing_x` | `int4` |  Nullable |
| `crossing_y` | `int4` |  Nullable |

## Table `diagrams`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `diagram_id` | `int4` | Primary |
| `extension` | `int4` | Primary |
| `name_rolf` | `text` |  Nullable |
| `given_name` | `text` |  Nullable |
| `conversion_for_full_notation` | `text` |  Nullable |
| `start_line` | `int4` |  Nullable |

## Table `diagrams_rolf`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` | Primary |
| `name_rolf` | `text` |  Nullable |
| `conversion_for_full_notation` | `text` |  Nullable |
| `start_line` | `text` |  Nullable |
| `diagram_id` | `numeric` |  Nullable |

## Table `invariants_rolf`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` |  |
| `name` | `text` |  Nullable |
| `determinant` | `int4` |  Nullable |
| `alexander_polynomial` | `text` |  Nullable |
| `jones_polynomial` | `text` |  Nullable |

## Table `knots`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` | Primary Identity |
| `name` | `text` |  Nullable |
| `full_notation` | `jsonb` |  Nullable |

## Table `moves`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `diagram_id` | `int4` |  Nullable |
| `extension` | `int4` |  Nullable |
| `move_name` | `text` |  Nullable |
| `crossing_id1_1` | `int4` |  Nullable |
| `crossing_id2_1` | `int4` |  Nullable |
| `crossing_id1_2` | `int4` |  Nullable |
| `crossing_id2_2` | `int4` |  Nullable |
| `cid1_1_ou` | `text` |  Nullable |
| `cid2_1_ou` | `text` |  Nullable |
| `cid1_2_ou` | `text` |  Nullable |
| `cid2_2_ou` | `text` |  Nullable |

## Table `vertices_and_arrows`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `diagram_id` | `int4` |  Nullable |
| `extension` | `int4` |  Nullable |
| `start_point` | `int4` |  Nullable |
| `end_point` | `int4` |  Nullable |
| `strand_x` | `int4` |  Nullable |
| `strand_y` | `int4` |  Nullable |

## Table `vertices_and_arrows_rolf`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `diagram_id` | `int4` |  |
| `start_point` | `int4` |  |
| `end_point` | `int4` |  |
| `strand_x` | `int4` |  |
| `strand_y` | `int4` |  |

