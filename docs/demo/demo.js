// Written by scripts/demo.mjs — the extension APIs, standing in for a web page.
//
// The demo runs the extension's own code unchanged, which means it calls a few
// chrome.* APIs that do not exist here. Each one below answers the way the app
// expects; nothing pretends to be more than it is. chrome.identity is left out
// entirely, so Google Drive sync reports itself unavailable — which it is.
(() => {
  const noop = () => {};
  const shim = {
    runtime: {
      id: "easy-note-demo",
      getManifest: () => ({ version: "3.3.0" }),
      getURL: (p) => new URL(p, document.baseURI).href,
      onMessage: { addListener: noop, removeListener: noop },
      sendMessage: () => Promise.resolve(),
      lastError: null,
    },
  };
  try {
    Object.defineProperty(window, "chrome", { value: shim, writable: true, configurable: true });
  } catch (err) {
    window.chrome = shim;
  }
})();
