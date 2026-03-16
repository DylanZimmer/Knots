#!/usr/bin/env sage -python

from src import db
from sage.all import Knot

"""
def import_all_invariants(knot_id_map):
    for rolf_name, knot_id in knot_id_map.items():
        K = Knot(rolf_name)

        db.insert_invariants(
            knot_id=knot_id,
            determinant=K.determinant(),
            signature=K.signature(),
            unknotting_number=K.unknotting_number(),
            genus=K.genus(),
            bridge_number=K.bridge_number(),
            hyperbolic_volume=K.hyperbolic_volume(),
            chern_simons=None,
            slice_knot=K.is_slice(),
            fibered=K.is_fibered(),
            alexander_polynomial=str(K.alexander_polynomial()),
            jones_polynomial=str(K.jones_polynomial()),
            homfly_polynomial=str(K.homfly_polynomial()),
            kauffman=str(K.kauffman_polynomial()),
            crossing_number=K.crossing_number(),
            alternating=K.is_alternating()
        )
"""