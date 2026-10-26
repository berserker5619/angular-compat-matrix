// The published package's postinstall: writes "ran" to $NGM_CANARY_FILE, so a test can tell
// whether install scripts ran. It does nothing else.
const file = process.env.NGM_CANARY_FILE;
if (file) require('node:fs').writeFileSync(file, 'ran');
