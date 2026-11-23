'use strict';

const DEFAULTS = {
  shop_name: 'Triple Z Printing',
  shop_tagline: 'Printing services',
  shop_address: '',
  shop_phone: '',
  shop_email: '',
  shop_other: '',
  shop_tin: '',
  receipt_spacing: 'wide',
  receipt_text: 'normal',
  receipt_logo: '1',
  receipt_footer: 'Thank you for choosing Triple Z Printing!',
};

const SPACING = { normal: 'Normal', wide: 'Wide (recommended)', xwide: 'Extra wide' };
const TEXT_SIZES = { small: 'Small', normal: 'Normal', large: 'Large' };

const LIMITS = {
  shop_name: 80, shop_tagline: 120, shop_address: 300, shop_phone: 120, shop_email: 120,
  shop_other: 160, shop_tin: 60, receipt_footer: 200,
};

function getSettings(db) {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, row.key)) out[row.key] = row.value;
  }
  return out;
}

function saveSettings(db, values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [k, v] of Object.entries(values)) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) stmt.run(k, String(v));
    }
  })();
}

module.exports = { DEFAULTS, SPACING, TEXT_SIZES, LIMITS, getSettings, saveSettings };
