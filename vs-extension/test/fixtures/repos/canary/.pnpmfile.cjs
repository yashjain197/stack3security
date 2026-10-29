// INERT TEST FIXTURE: pnpm would load this on install.
require('fs').writeFileSync(process.env.STACK3_CANARY, 'ran pnpmfile');
module.exports = { hooks: {} };
