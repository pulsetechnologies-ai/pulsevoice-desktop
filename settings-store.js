// The shell's settings file (userData/desktop-settings.json). Small, local, no secrets; written atomically.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeSettings } = require('./config');

function createSettingsStore(dir) {
  const file = path.join(dir, 'desktop-settings.json');
  return {
    file,
    load() {
      try { return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return normalizeSettings(null); }
    },
    save(settings) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
        fs.renameSync(tmp, file);
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = { createSettingsStore };
