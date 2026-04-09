from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import json
import math

def parse_braid(braid_string: str) -> list[int]:
    """Parse braid word stored as '[1,-2,1,-2]' into a list of signed ints."""
    return json.loads(braid_string)