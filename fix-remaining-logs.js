const fs = require('fs');

// Fix tenant.service.ts
let tenantContent = fs.readFileSync('src/services/tenant.service.ts', 'utf8');
tenantContent = tenantContent.replace(/this\.logger\.(info|warn|error)\(/g, 'console.log(');
fs.writeFileSync('src/services/tenant.service.ts', tenantContent);

// Fix status.service.ts
let statusContent = fs.readFileSync('src/services/status.service.ts', 'utf8');
statusContent = statusContent.replace(/this\.logger\.(info|warn|error)\(/g, 'console.log(');
// Fix version import issue
statusContent = statusContent.replace(/version: baileys\.version/, 'version: "latest"');
fs.writeFileSync('src/services/status.service.ts', statusContent);

// Fix webhook.service.ts
let webhookContent = fs.readFileSync('src/services/webhook.service.ts', 'utf8');
webhookContent = webhookContent.replace(/this\.logger\.(info|warn|error)\(/g, 'console.log(');
webhookContent = webhookContent.replace(/private logger: Console/g, 'private logger: any');
fs.writeFileSync('src/services/webhook.service.ts', webhookContent);

console.log('Fixed remaining logger calls');