'use strict';

// Not configurable by input options: all parser/walker entry points share this
// ceiling, including callers that supply an AST instead of a pattern string.
const MAX_DEPTH = 64;

exports.assertDepth = depth => {
  if (depth > MAX_DEPTH) {
    throw new SyntaxError('Brace pattern exceeds the maximum nesting depth (64)');
  }
};
