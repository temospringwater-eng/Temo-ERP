'use strict';

// Legacy Express bootstrap only. Cloudflare Workers use env.DB and do not listen on TCP.
const DEFAULT_PORT = 3000;
function parseServerPort(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_PORT;
  const raw = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new RangeError('Invalid TCP port: expected an integer from 0 to 65535');
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new RangeError('Invalid TCP port: expected an integer from 0 to 65535');
  }
  return port;
}

function nextServerPort(port) {
  // Port 0 means OS selection; ports above 65535 cannot exist.
  if (!Number.isInteger(port) || port < 1 || port >= 65535) {
    throw new RangeError('No safe retry TCP port available');
  }
  return port + 1;
}
module.exports = { parseServerPort, nextServerPort };
