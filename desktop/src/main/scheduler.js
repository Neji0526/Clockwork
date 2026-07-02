// Periodic scheduler — the Electron equivalent of chrome.alarms.
//
// The MV3 service worker used chrome.alarms because it was frequently
// suspended and revived; alarms survived suspension. The Electron main process
// is long-lived and never suspended, so we implement the SAME named-alarm API
// on top of setTimeout/setInterval. The dispatch contract is preserved: a
// single onAlarm(name) handler receives every tick, exactly like
// chrome.alarms.onAlarm, so core.js's alarm switch is unchanged.
//
// ensureAlarm()'s idempotency is preserved for parity: creating an alarm with
// the same period is a no-op (it does NOT reset the period start).

const alarms = new Map(); // name -> { period, delayTimer, interval }
let onAlarmCb = null;

function onAlarm(cb) {
  onAlarmCb = cb;
}

function fire(name) {
  if (onAlarmCb) {
    try {
      onAlarmCb({ name });
    } catch (e) {
      /* non-fatal */
    }
  }
}

// chrome.alarms.create(name, { periodInMinutes, delayInMinutes })
function create(name, opts) {
  clear(name);
  const period = Number(opts && opts.periodInMinutes) || 0;
  const delay = Number(opts && opts.delayInMinutes) || 0;
  const rec = { period, delayTimer: null, interval: null };
  const startInterval = () => {
    if (period > 0) {
      rec.interval = setInterval(() => fire(name), period * 60_000);
    }
  };
  if (delay > 0) {
    rec.delayTimer = setTimeout(() => {
      fire(name);
      startInterval();
    }, delay * 60_000);
  } else if (period > 0) {
    startInterval();
  }
  alarms.set(name, rec);
}

// chrome.alarms.get(name) -> { name, periodInMinutes } | undefined
function get(name) {
  const rec = alarms.get(name);
  if (!rec) return undefined;
  return { name, periodInMinutes: rec.period };
}

// chrome.alarms.clear(name)
function clear(name) {
  const rec = alarms.get(name);
  if (rec) {
    if (rec.delayTimer) clearTimeout(rec.delayTimer);
    if (rec.interval) clearInterval(rec.interval);
    alarms.delete(name);
  }
  return true;
}

module.exports = { create, get, clear, onAlarm };
