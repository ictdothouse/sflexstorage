const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    // Remove PhotoVault from footer
    if (content.includes('<span id="site-title-footer">PhotoVault</span>')) {
        content = content.replace('<span id="site-title-footer">PhotoVault</span>', '<span id="site-title-footer"></span>');
        changed = true;
    }
    
    // For text-muted, let's leave it as empty or generic until JS loads
    if (content.includes('© 2024 PhotoVault. All rights reserved.')) {
        content = content.replace('© 2024 PhotoVault. All rights reserved.', '');
        changed = true;
    }
    if (content.includes('© 2024 PhotoVault.')) {
        content = content.replace('© 2024 PhotoVault.', '');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Fixed FOUC in:', filePath);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'admin') walkDir(fullPath);
        } else if (fullPath.endsWith('.html')) {
            processFile(fullPath);
        }
    }
}

walkDir(publicDir);
console.log('Done fixing FOUC.');
