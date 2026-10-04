// Staging integration fallback only.
// Water Club Step 4B does not depend on AI automation routes.
function createService() { return { initialize() {}, registerRoutes() {} }; }
module.exports = { createService, CHANNELS: [] };
