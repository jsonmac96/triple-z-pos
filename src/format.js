'use strict';

const TZ = 'Asia/Manila';
const TZ_OFFSET = '+08:00'; // Philippines has no daylight saving time

const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const dtFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const dFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, dateStyle: 'medium' });
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const peso = (cents) => pesoFmt.format((Number(cents) || 0) / 100);
const dateTime = (iso) => (iso ? dtFmt.format(new Date(iso)) : '');
const dateOnly = (iso) => (iso ? dFmt.format(new Date(iso)) : '');

function manilaParts(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return p;
}

/** 'YYYY-MM-DD' of the given instant in Manila time. */
function manilaDay(date = new Date()) {
  const p = manilaParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Value for <input type="datetime-local"> in Manila time. */
function toLocalInput(iso) {
  if (!iso) return '';
  const p = manilaParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Parse 'YYYY-MM-DDTHH:MM' entered in Manila time into an ISO UTC string, or null. */
function parseLocalInput(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return null;
  const d = new Date(`${str}:00${TZ_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Start of a Manila calendar day ('YYYY-MM-DD') as ISO UTC. */
function dayStartIso(day) {
  return new Date(`${day}T00:00:00${TZ_OFFSET}`).toISOString();
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Parse a peso amount string like "1,250.50" into integer centavos, or null. */
function parsePeso(str) {
  if (str === undefined || str === null) return null;
  const s = String(str).replace(/[,\s₱]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

module.exports = { TZ, TZ_OFFSET, peso, dateTime, dateOnly, manilaDay, toLocalInput, parseLocalInput, dayStartIso, addDays, parsePeso };
