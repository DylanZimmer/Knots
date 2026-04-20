Hosted at knotresearch.netlify.app.

A research tool for exploring knots as mathematical objects. Generate oriented diagrams of any Rolfsen table knot up to 13 crossings, apply combinatorial and topological moves, and track how knot invariants change across sequences of transformations.

is a full-stack research application built for knot theorists who want to experiment with knot diagrams programmatically. It bridges a React/TypeScript frontend with a Python backend powered by SageMath and SnapPy, exposing a clean interface for diagram manipulation and invariant computation.

The core idea is to make it easy to ask and answer questions of the form :
  If I apply this set of moves on this knot or set of knots, what will happen to their invariants?

Features :
- Diagram Generation
Render oriented diagrams for any knot in the Rolfsen table up to 13 crossings
Diagrams are generated with full crossing and orientation data, not just images

- Moves & Transformations
Flip Orientation: Reverse the orientation of a knot
Mirror: Produce the mirror image of a knot
Reidemeister Moves: Apply R1, R2, or R3 moves on applicable strands
Saddle Flip: Perform a saddle move between strands
Smoothing: Resolve a knot to its ambient isotopy representative

- Invariant Tracking
Computes and logs how invariants change across transformations

- Batch Operations
Define sequences of moves and apply them to sets of knots simultaneously
Export invariant change data for downstream analysis



Actively under development. Current work is focused on:
 Stabilizing the move engine for all Reidemeister types
 Expanding batch operation export formats
 UI for visualizing invariant deltas across move sequences
