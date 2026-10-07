// Supprime out/ avant compilation : un ancien out/parser.js masquerait out/parser/index.js
require('fs').rmSync(require('path').join(__dirname, '..', 'out'), { recursive: true, force: true });
