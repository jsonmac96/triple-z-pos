'use strict';
// Polls for overdue / urgent orders, updates the bell and shows browser notifications.
(function () {
  const POLL_MS = 60 * 1000;
  const countEl = document.getElementById('alert-count');
  const bell = document.getElementById('alert-bell');
  const enableBtn = document.getElementById('enable-notify');
  const canNotify = 'Notification' in window;

  function seen() {
    try { return JSON.parse(sessionStorage.getItem('tz-notified') || '{}'); } catch { return {}; }
  }
  function remember(map) {
    try { sessionStorage.setItem('tz-notified', JSON.stringify(map)); } catch { /* storage unavailable */ }
  }

  if (canNotify && Notification.permission === 'default') {
    enableBtn.hidden = false;
    enableBtn.addEventListener('click', () => {
      Notification.requestPermission().then(() => { enableBtn.hidden = true; poll(); });
    });
  }

  let lastCount = null;
  function update(data) {
    countEl.textContent = String(data.count);
    countEl.hidden = data.count === 0;
    if (lastCount !== null && data.count > lastCount) {
      bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring');
    }
    lastCount = data.count;
    if (!canNotify || Notification.permission !== 'granted') return;
    const map = seen();
    data.orders.forEach((o) => {
      const key = `${o.id}:${o.urgency}`;
      if (map[key]) return;
      map[key] = 1;
      const title = o.urgency === 'overdue' ? `OVERDUE: ${o.order_no}` : `Urgent: ${o.order_no}`;
      const n = new Notification(title, { body: `${o.customer_name} — due ${o.time_left}`, tag: key });
      n.onclick = () => { window.focus(); window.location.href = `/orders/${encodeURIComponent(o.id)}`; };
    });
    remember(map);
  }

  function poll() {
    fetch('/api/alerts', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return null; }
        return r.ok ? r.json() : null;
      })
      .then((d) => { if (d) update(d); })
      .catch(() => { /* offline; try again next tick */ });
  }

  poll();
  setInterval(poll, POLL_MS);
}());
