// Staging integration fallback only.
// No WhatsApp provider or webhook is enabled by this fallback.
function createService() { return { initialize() {}, registerRoutes() {} }; }
module.exports = { createService };
