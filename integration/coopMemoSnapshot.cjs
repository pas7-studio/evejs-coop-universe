"use strict";
// A memo wrapper for a registry that itself exposes snapshot().
//
// The first version was `Object.create(real)` plus `wrapper.snapshot = ...`.
// That is a TypeError in strict mode whenever the source object is frozen (the
// war fleet registry returns Object.freeze({snapshot,claim,execute})), because the
// inherited `snapshot` is a read-only own property: measured live 2026-11-03, the
// garrison phase threw "Cannot assign to read only property 'snapshot'" on EVERY
// tick, so no garrison was ever refilled. The wrapper must be a writable COPY, and
// a failure here must never take a phase down with it.
function wrapSnapshot(source, readSnapshot) {
  const real = source && typeof source === "object" ? source : {};
  let wrapper;
  try {
    const proto = Object.getPrototypeOf(real);
    wrapper = Object.assign(proto ? Object.create(proto) : {}, real);
  } catch (_error) {
    return real;
  }
  try {
    wrapper.snapshot = () => {
      try {
        return typeof real.snapshot === "function" ? readSnapshot(real) : {};
      } catch (_error) {
        return {};
      }
    };
  } catch (_error) {
    return real;
  }
  return wrapper;
}

module.exports = { wrapSnapshot };
