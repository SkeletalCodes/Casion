// Every /api/* request is rewritten here (see vercel.json) and routed by server/app.js.
const { handle } = require('../server/app');

module.exports = handle;
