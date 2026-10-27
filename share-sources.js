// Pure helpers for the screen-share picker, kept free of Electron so node tests can pin them.

/** Screens ('screen:…') come before windows; each row carries only what the picker page needs. */
function toRows(sources) {
  const rows = (Array.isArray(sources) ? sources : [])
    .filter((s) => s && typeof s.id === 'string' && s.id)
    .map((s) => ({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 120) : s.id,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail && typeof s.thumbnail.toDataURL === 'function' && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
      icon: s.appIcon && typeof s.appIcon.toDataURL === 'function' && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }));
  return [...rows.filter((r) => r.kind === 'screen'), ...rows.filter((r) => r.kind === 'window')];
}

/** The picker page is untrusted input: only an id we offered it may be chosen. */
function findOffered(rows, id) {
  return typeof id === 'string' ? rows.find((r) => r.id === id) ?? null : null;
}

/** System audio is only offered where Electron can loopback it (Windows) and only when the page asked for audio. */
function audioOffered(request, platform) {
  return Boolean(request && request.audioRequested) && platform === 'win32';
}

module.exports = { toRows, findOffered, audioOffered };
