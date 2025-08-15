const fs = require('fs');
const path = require('path');

// Fix persistent-qr.service.ts
let persistentQRContent = fs.readFileSync('src/services/persistent-qr.service.ts', 'utf8');

// Replace all logger calls with console.log temporarily
persistentQRContent = persistentQRContent.replace(/this\.logger\.(info|warn|error)\(/g, 'console.log(');

fs.writeFileSync('src/services/persistent-qr.service.ts', persistentQRContent);

// Fix whatsapp.service.ts
let whatsappContent = fs.readFileSync('src/services/whatsapp.service.ts', 'utf8');

// Replace problematic logger calls
whatsappContent = whatsappContent.replace(/this\.logger\.(info|warn|error)\(/g, 'console.log(');
whatsappContent = whatsappContent.replace(/\(this\.logger as any\)\.(info|warn|error)\(/g, 'console.log(');

fs.writeFileSync('src/services/whatsapp.service.ts', whatsappContent);

console.log('Fixed logger calls in both files');