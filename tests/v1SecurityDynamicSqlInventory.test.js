const fs = require('fs');
const path = require('path');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

describe('V1 dynamic SQL inventory', () => {
  test('all template-interpolated query text is explicitly reviewed', () => {
    const srcRoot = path.join(__dirname, '../src');
    const offenders = [];
    const queryTemplate = /\.query\s*\(\s*`([\s\S]*?)`/g;

    for (const file of walkJs(srcRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = queryTemplate.exec(source)) !== null) {
        if (!match[1].includes('${')) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(srcRoot, file)}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
