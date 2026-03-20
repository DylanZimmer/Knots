#!/usr/bin/env sage -python

from . import db
from sage.all import Knots

def import_all_invariants(knot_id_map):
    for rolf_name, knot_id in knot_id_map.items():
        crossings, index = map(int, rolf_name.split("_"))
        K = Knots().from_table(crossings, index)

        db.insert_invariants(
            knot_id=knot_id,
            determinant=int(getattr(K, "determinant", lambda: 0)()),
            signature=int(getattr(K, "signature", lambda: 0)()),
            crossing_number=int(getattr(K, "crossing_number", lambda: 0)()),
            genus=int(getattr(K, "genus", lambda: 0)()),
            hyperbolic=bool(getattr(K, "is_hyperbolic", lambda: False)()),
            slice_knot=bool(getattr(K, "is_slice", lambda: False)()),
            fibered=bool(getattr(K, "is_fibered", lambda: False)()),
            alexander_polynomial=str(getattr(K, "alexander_polynomial", lambda: None)() or None),
            jones_polynomial=str(getattr(K, "jones_polynomial", lambda: None)() or None),
            homfly_polynomial=str(getattr(K, "homfly_polynomial", lambda: None)() or None),
            kauffman_polynomial=str(getattr(K, "kauffman_polynomial", lambda: None)() or None),
            alternating=bool(getattr(K, "is_alternating", lambda: False)()),
            braid_index=int(getattr(K, "braid_index", lambda: 0)()),
            braid_length=int(getattr(K, "braid_length", lambda: 0)()),
            braid_notation=str(getattr(K, "braid_notation", lambda: None)()),
        )