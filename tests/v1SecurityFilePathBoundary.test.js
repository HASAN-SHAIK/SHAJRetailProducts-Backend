const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcRoot = path.join(root, 'src');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('V1 HTTP file/path boundary', () => {
  test('HTTP runtime does not pass request-controlled path data to filesystem/process APIs', () => {
    const violations = [];
    const requestPathValue = /req(?:uest)?\s*\.\s*(?:body|query|params|file|files)(?:\s*\.|\s*\[)/;
    const riskyCall = /(?:fs\s*\.\s*(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|unlinkSync|rm|rmSync|rename|renameSync|copyFile|copyFileSync)|child_process\s*\.\s*(?:exec|execSync|spawn|spawnSync)|(?:exec|execSync|spawn|spawnSync))\s*\(([^\n;]*)/g;

    for (const file of walkJs(srcRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = riskyCall.exec(source)) !== null) {
        if (requestPathValue.test(match[1])) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${path.relative(srcRoot, file)}:${line}`);
        }
      }

      // The HTTP runtime must not depend on multer disk paths. Upload admission is
      // deliberately memory-only so caller filenames never become executable paths.
      if (/multer\s*\.\s*diskStorage\s*\(/.test(source) || /req\s*\.\s*file\s*\.\s*path/.test(source)) {
        violations.push(`${path.relative(srcRoot, file)}:disk-upload-path`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('known V1 upload parsers remain memory-only, bounded and content-verified', () => {
    const invoiceRoutes = read('src/routes/purchaseInvoiceRoutes.js');
    const invoicePolicy = read('src/security/invoiceUploadPolicy.js');
    const importPolicy = read('src/security/productImportUploadPolicy.js');

    expect(invoiceRoutes).toContain('multer.memoryStorage()');
    expect(invoiceRoutes).toMatch(/fileSize:\s*5\s*\*\s*1024\s*\*\s*1024/);
    expect(invoiceRoutes).not.toMatch(/diskStorage|req\.file\.path/);
    expect(invoicePolicy).toMatch(/signature|content/i);
    expect(importPolicy).toMatch(/signature|content/i);
  });

  test('operator database restore remains outside the HTTP request path boundary', () => {
    const policy = read('docs/V1_SECURITY_FILE_PATH_BOUNDARY.md');
    expect(policy).toContain('operator-only');
    expect(policy).toContain('same-tenant');
    expect(policy).toContain('not an HTTP upload or download path');
  });
});
