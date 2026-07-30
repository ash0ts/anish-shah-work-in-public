export const env = new Proxy(
  {},
  {
    get(_target, property) {
      return globalThis.__ANISH_CONNECTOR_TEST_ENV__?.[property];
    },
  },
);
