// Persistent storage — the Electron equivalent of chrome.storage.local.
//
// electron-store gives us a JSON-backed, synchronous key/value store on disk.
// We wrap it in the exact async get/set/remove shape the ported logic expects
// (chrome.storage.local.get("k") -> { k: value }), so core.js reads almost
// identically to the original background.js.

const Store = require("electron-store");

// unlimitedStorage in the extension manifest -> no artificial size cap here.
const store = new Store({ name: "clockwork" });

function get(keys) {
  // Mirrors chrome.storage.local.get: accepts a string, an array, or an object
  // of defaults, and resolves an object of the requested keys.
  return new Promise((resolve) => {
    if (keys == null) {
      resolve({ ...store.store });
      return;
    }
    const out = {};
    if (typeof keys === "string") {
      out[keys] = store.get(keys);
    } else if (Array.isArray(keys)) {
      for (const k of keys) out[k] = store.get(k);
    } else if (typeof keys === "object") {
      for (const k of Object.keys(keys)) {
        const v = store.get(k);
        out[k] = v === undefined ? keys[k] : v;
      }
    }
    resolve(out);
  });
}

function set(obj) {
  return new Promise((resolve) => {
    for (const k of Object.keys(obj || {})) store.set(k, obj[k]);
    resolve();
  });
}

function remove(key) {
  return new Promise((resolve) => {
    if (Array.isArray(key)) key.forEach((k) => store.delete(k));
    else store.delete(key);
    resolve();
  });
}

// Exposed with the same nested shape as chrome.storage so both the ported main
// logic and the renderer chrome-shim can use it uniformly.
module.exports = {
  local: { get, set, remove },
  get,
  set,
  remove,
};
