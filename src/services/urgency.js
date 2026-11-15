'use strict';

const HOUR = 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['pending', 'in_progress']);

const LEVELS = {
  overdue: { label: 'Overdue', rank: 0 },
  urgent: { label: 'Urgent', rank: 1 },
  soon: { label: 'Due soon', rank: 2 },
  normal: { label: 'On track', rank: 3 },
  none: { label: '', rank: 4 },
};

/**
 * Classify how urgent an order is from its deadline, priority and status.
 * Only orders still being worked on (pending / in progress) can be urgent;
 * ready, released and cancelled orders return 'none'.
 */
function classify(order, now = Date.now()) {
  if (!ACTIVE_STATUSES.has(order.status)) return 'none';
  const left = new Date(order.deadline_at).getTime() - now;
  if (left < 0) return 'overdue';
  if (left <= 24 * HOUR) return 'urgent';
  if (order.priority === 'rush' && left <= 48 * HOUR) return 'urgent';
  if (left <= 72 * HOUR) return 'soon';
  return 'normal';
}

/** Human readable "in 3h" / "2d late" text. */
function timeLeftText(order, now = Date.now()) {
  const ms = new Date(order.deadline_at).getTime() - now;
  const abs = Math.abs(ms);
  let txt;
  if (abs < HOUR) txt = `${Math.max(1, Math.round(abs / 60000))}m`;
  else if (abs < 48 * HOUR) txt = `${Math.round(abs / HOUR)}h`;
  else txt = `${Math.round(abs / (24 * HOUR))}d`;
  return ms < 0 ? `${txt} late` : `in ${txt}`;
}

module.exports = { classify, timeLeftText, LEVELS, ACTIVE_STATUSES };
