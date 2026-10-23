'use strict';

const INSUFFICIENT_HISTORY = 'insufficient_history';

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.round(days));
  return date.toISOString().slice(0, 10);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Calculates transparent reorder metrics from recorded order rows only. */
function calculateReorderInsight(rows, rule = {}, today = new Date().toISOString().slice(0, 10)) {
  const orders = new Map();
  rows.forEach((row) => {
    const key = Number(row.order_id);
    if (!orders.has(key)) orders.set(key, { date: dateOnly(row.order_date), quantity: 0 });
    orders.get(key).quantity += Number(row.quantity) || 0;
  });
  const history = [...orders.values()].filter((order) => order.date && order.quantity > 0).sort((a, b) => a.date.localeCompare(b.date));
  const minimumOrders = Number.isInteger(Number(rule.minimum_orders)) ? Number(rule.minimum_orders) : 2;
  const base = { orderCount: history.length, minimumOrders, status: INSUFFICIENT_HISTORY, reliable: false, averageConsumption: null, lastOrder: history.length ? history[history.length - 1].date : null, averageIntervalDays: null, expectedNextOrder: null, suggestedQuantity: null, reminderEligible: false };
  if (history.length < minimumOrders) return base;
  const intervals = [];
  for (let i = 1; i < history.length; i += 1) {
    const days = (Date.parse(`${history[i].date}T00:00:00Z`) - Date.parse(`${history[i - 1].date}T00:00:00Z`)) / 86400000;
    if (days > 0) intervals.push(days);
  }
  if (!intervals.length) return base;
  const averageIntervalDays = average(intervals);
  const averageConsumption = average(history.map((order) => order.quantity));
  const expectedNextOrder = addDays(history[history.length - 1].date, averageIntervalDays);
  const buffer = Number(rule.quantity_buffer_percent) || 0;
  const suggestedQuantity = Math.max(1, Math.round(averageConsumption * (1 + buffer / 100)));
  const leadDays = Math.max(0, Number(rule.reminder_lead_days) || 0);
  const reminderEligible = Boolean(rule.enabled !== 0 && today >= addDays(expectedNextOrder, -leadDays));
  return { ...base, status: 'ready', reliable: true, averageConsumption: Number(averageConsumption.toFixed(2)), averageIntervalDays: Number(averageIntervalDays.toFixed(2)), expectedNextOrder, suggestedQuantity, reminderEligible };
}

module.exports = { calculateReorderInsight, INSUFFICIENT_HISTORY };
