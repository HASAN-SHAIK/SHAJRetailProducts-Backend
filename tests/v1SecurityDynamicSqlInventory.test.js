const fs = require('fs');
const path = require('path');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

const BASELINE_INTERPOLATED_QUERY_COUNT = 79;

describe('V1 dynamic SQL inventory', () => {
  test('template-interpolated query inventory cannot grow silently', () => {
    const srcRoot = path.join(__dirname, '../src');
    const sites = [];
    const directRequestSites = [];
    const expressionsBySite = [];
    const queryTemplate = /\.query\s*\(\s*`([\s\S]*?)`/g;
    const directRequestInterpolation = /\$\{\s*req(?:uest)?(?:\.|\[)/;
    const interpolation = /\$\{([^}]+)\}/g;

    for (const file of walkJs(srcRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = queryTemplate.exec(source)) !== null) {
        if (!match[1].includes('${')) continue;
        const line = source.slice(0, match.index).split('\n').length;
        const site = `${path.relative(srcRoot, file)}:${line}`;
        sites.push(site);
        if (directRequestInterpolation.test(match[1])) directRequestSites.push(site);

        const expressions = [];
        let expressionMatch;
        while ((expressionMatch = interpolation.exec(match[1])) !== null) {
          expressions.push(expressionMatch[1].trim());
        }
        expressionsBySite.push({ site, expressions });
      }
    }

    // This is an inventory gate, not a blanket safety assertion. Any new or
    // removed interpolation site must intentionally update this audit, while
    // follow-up Security work reviews/reduces the existing sites by domain.
    if (sites.length !== BASELINE_INTERPOLATED_QUERY_COUNT) {
      throw new Error(
        `Dynamic SQL inventory changed from ${BASELINE_INTERPOLATED_QUERY_COUNT} sites to ${sites.length}.\n` +
        `Current sites:\n${sites.sort().join('\n')}`
      );
    }

    // Emit the exact structural expressions while this V1 review classifies
    // every legacy interpolation family. This contains source identifiers only,
    // never runtime request or database values.
    console.log('V1_DYNAMIC_SQL_EXPRESSIONS', JSON.stringify(expressionsBySite));

    // Fail immediately on direct HTTP request-object interpolation. Local
    // arrays/fragments named params/query are not assumed to be request data;
    // they remain visible in the 79-site structural-interpolation inventory.
    expect(directRequestSites).toEqual([]);
  });
});
