# Bounded braces build dependency

Local security fork of MIT-licensed [braces 3.0.3](https://github.com/micromatch/braces/tree/3.0.3).
Last verified: 2026-10-22.

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
has no published upstream patch. Vinext's CommonJS plugin and Next's lint tooling
still depend on this package through micromatch/fast-glob. The npm override
replaces that implementation; it does not ignore an advisory or claim an
unmodified package is patched. This code is build tooling, not an application API.

## Delta and boundary

- Preserve the upstream API, syntax, range limits, and MIT license.
- Reject parser nesting above 64, counting braces and parentheses, including
  unterminated patterns. Escapes, quotes, and character classes retain the
  upstream parser's treatment.
- Bound compile, stringify, expand, append, array flattening, and parent-chain
  walks independently. Supplied ASTs and direct internal imports cannot bypass
  the depth guard. Options cannot raise or disable it.
- Remove the upstream compile debug print to avoid leaking pattern text.
- Pin fill-range to 7.1.1; no new runtime package is introduced.

This is a targeted stack-exhaustion fix, not a claim that arbitrary expansion
is free of every resource-exhaustion risk. Keep build glob patterns trusted;
never expose this package to visitor input. Tests in
`tests/dependency-security-replacements.test.mjs` cover ordinary globs, ranges,
malformed/deep patterns, supplied ASTs, parent cycles, and downstream consumers.

Remove the override when an upstream release fixes the advisory and passes
these compatibility and security tests. Do not silently update the vendor copy.

## Upstream provenance

npm tarball integrity (braces@3.0.3):
`sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`.
The original, pre-patch file SHA-256 values are:

| File | SHA-256 |
| --- | --- |
| `index.js` | `332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4` |
| `lib/compile.js` | `dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f` |
| `lib/expand.js` | `41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7` |
| `lib/stringify.js` | `379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a` |
| `lib/parse.js` | `e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310` |
| `lib/constants.js` | `c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b` |
| `lib/utils.js` | `b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7` |
| `LICENSE` | `35bdd8a44339719441900fb50fbefc5e2dca1ca662cbaed7a687de842c8b70f2` |
