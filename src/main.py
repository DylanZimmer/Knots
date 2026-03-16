from src import calculations
from src import db
from src import populate_invariants

def main():
    db.create_tables()

    knots_to_import = [
        ("3_1", True),
        ("4_1", True),
        ("5_1", True)
    ]

    id_map = db.populate_knots(knots_to_import)

    populate_invariants.import_all_invariants(id_map)

    


if __name__ == "__main__":
    main()