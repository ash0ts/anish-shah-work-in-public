# Bounded build-time image metadata

This private package replaces Vinext's transitive `image-size@2.0.2` parser.
That upstream release has unpatched infinite-loop advisories in its ICNS,
HEIF/AVIF, and JXL parsers. The site build only needs deterministic dimensions
for checked-in assets, so this reader supports PNG, JPEG, GIF, WebP, SVG, BMP,
and ICO with bounded, monotonic parsing and rejects every other format.

Do not broaden the format list without parser tests and a security review.
