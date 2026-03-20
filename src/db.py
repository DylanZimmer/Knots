import sqlite3
import json
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "data" / "knots.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def drop_tables():
    conn = get_connection()
    conn.execute(f"DROP TABLE IF EXISTS knots")
    conn.execute(f"DROP TABLE IF EXISTS invariants")
    conn.execute(f"DROP TABLE IF EXISTS calculations")
    conn.commit()
    conn.close()

def create_tables():
    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS knots (
            id INTEGER PRIMARY KEY,
            rolf_name TEXT UNIQUE,
            prime BOOLEAN
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS invariants (
            knot_id INTEGER PRIMARY KEY,
            determinant INTEGER,
            signature INTEGER,
            crossing_number INTEGER,
            genus INTEGER,
            hyperbolic BOOLEAN,
            slice BOOLEAN,
            fibered BOOLEAN,
            alexander_polynomial TEXT,
            jones_polynomial TEXT,
            homfly_polynomial TEXT,
            kauffman TEXT,
            alternating BOOLEAN,
            braid_index INTEGER,
            braid_length INTEGER,
            braid_notation TEXT,
            FOREIGN KEY(knot_id) REFERENCES knots(id)
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS calculations (
            knot_id INTEGER PRIMARY KEY,
            alexander_degree INTEGER,
            jones_span INTEGER,
            det_log REAL,
            signature_abs INTEGER,
            FOREIGN KEY(knot_id) REFERENCES knots(id)
        )            
        """)
        conn.commit()

def insert_knot(rolf_name, prime):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO knots (rolf_name, prime)
            VALUES (?, ?)
        """, (rolf_name, prime))
        cursor.execute("SELECT id FROM knots WHERE rolf_name = ?", (rolf_name,))
        knot_id = cursor.fetchone()["id"]
        conn.commit()
        return knot_id
    
def populate_knots(knot_list):
    id_map = {}
    for name, prime in knot_list:
        knot_id = insert_knot(name, prime)
        id_map[name] = knot_id
    return id_map

def insert_invariants(
    knot_id: int,
    determinant: Optional[int] = None,
    signature: Optional[int] = None,
    crossing_number: Optional[int] = None,
    genus: Optional[int] = None,
    hyperbolic: Optional[bool] = None,
    slice_knot: Optional[bool] = None,
    fibered: Optional[bool] = None,
    alexander_polynomial: Optional[str] = None,
    jones_polynomial: Optional[str] = None,
    homfly_polynomial: Optional[str] = None,
    kauffman_polynomial: Optional[str] = None,
    alternating: Optional[bool] = None,
    braid_index: Optional[int] = None,
    braid_length: Optional[int] = None,
    braid_notation: Optional[str] = None
):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            REPLACE INTO invariants (
                knot_id, determinant, signature,
                crossing_number, genus, hyperbolic, slice, fibered,
                alexander_polynomial, jones_polynomial, homfly_polynomial, kauffman,
                alternating, braid_index, braid_length, braid_notation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            knot_id,
            determinant,
            signature,
            crossing_number,
            genus,
            hyperbolic,
            slice_knot,
            fibered,
            alexander_polynomial,
            jones_polynomial,
            homfly_polynomial,
            kauffman_polynomial,
            alternating,
            braid_index,
            braid_length,
            braid_notation
        ))
        conn.commit()

def insert_calculations(knot_id: int, 
    alexander_degree: Optional[int]=None, 
    jones_span: Optional[int]=None, 
    det_log: Optional[float]=None,
    signature_abs: Optional[int]=None
):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            REPLACE INTO calculations (
                knot_id, alexander_degree, jones_span, det_log, signature_abs
            ) VALUES (?, ?, ?, ?, ?)
        """, (
            knot_id,
            alexander_degree,
            jones_span,
            det_log,
            signature_abs
        ))
    