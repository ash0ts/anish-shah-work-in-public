# Official brand source fixtures

These files are the exact bytes acquired from the official source recorded in
`content/presentation/brand-assets.v1.json`. They are test inputs, not public
assets. `npm run brand:check` verifies each `sourceSha256`, applies the only
allowed deployment transformation (removing SVG transport markup or PNG
metadata chunks), and requires the result to match the deployed bytes exactly.

The W&B source is `PNG/Endorsed_primary_black.png` from the official
`Weights_Biases_by_CoreWeave_Logos.zip` archive. The other fixtures were
downloaded directly from their registry `sourceAssetUrl` values.

Do not edit these files. Reacquire an official source and update its provenance,
hashes, and deployed derivative together.
