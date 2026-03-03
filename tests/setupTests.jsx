// Jest setup file — runs before the test framework initializes.
// Polyfills and global mocks for browser APIs used in utils.

// localStorage polyfill (jsdom provides it, but ensure it's available in all envs)
if (
  typeof global.localStorage === 'undefined' ||
  global.localStorage === null
) {
  const store = {};
  global.localStorage = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
  };
}

// matchMedia polyfill — antd-style 在模块加载时调用此 API
// jsdom 不实现 matchMedia，需手动 mock
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
