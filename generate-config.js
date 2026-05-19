// Script de build Vercel — génère config.js depuis les variables d'env.
// Usage : node generate-config.js
// Voir vercel.json buildCommand.
const fs = require("fs");

const { SUPA_URL = "", SUPA_PUBLISHABLE_KEY = "" } = process.env;

if (!SUPA_URL || !SUPA_PUBLISHABLE_KEY) {
  console.error(
    "[build] ATTENTION : SUPA_URL ou SUPA_PUBLISHABLE_KEY non défini. " +
      "Vérifier les variables d'env dans le dashboard Vercel."
  );
}

const content =
  `window.LRZ_CONFIG = { SUPA_URL: ${JSON.stringify(SUPA_URL)}, SUPA_PUBLISHABLE_KEY: ${JSON.stringify(SUPA_PUBLISHABLE_KEY)} };\n`;

fs.writeFileSync("config.js", content);
console.log("[build] config.js généré.");
