// Staging integration fallback only.
// Water Club Step 4B does not use supplier procurement.
function createService() { return { registerRoutes() {} }; }
module.exports = { createService };
