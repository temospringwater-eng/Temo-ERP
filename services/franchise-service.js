// Staging integration fallback only.
// Water Club Step 4B does not use franchise management.
function createService() { return { initialize() {}, async ready() {}, registerRoutes() {} }; }
module.exports = { createService };
