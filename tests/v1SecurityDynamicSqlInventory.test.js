const fs = require('fs');
const path = require('path');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

const BASELINE_INTERPOLATED_QUERY_COUNT = 81;

describe('V1 dynamic SQL inventory', () => {
  test('template-interpolated query inventory cannot grow silently', () => {
    const srcRoot = path.join(__dirname, '../src');
    const sites = [];
    const directInputSites = [];
    const queryTemplate = /\.query\s*\(\s*`([\s\S]*?)`/g;
    const directRequestInterpolation = /\$\{\s*(?:req(?:uest)?|body|params|query)(?:\.|\[)/;

    for (const file of walkJs(srcRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = queryTemplate.exec(source)) !== null) {
        if (!match[1].includes('${')) continue;
        const line = source.slice(0, match.index).split('\n').length;
        const site = `${path.relative(srcRoot, file)}:${line}`;
        sites.push(site);
        if (directRequestInterpolation.test(match[1])) directInputSites.push(site);
      }
    }

    // This is an inventory gate, not a blanket safety assertion. The first
    // exact-head run established the current legacy baseline. Any new or
    // removed interpolation site must intentionally update this audit, while
    // follow-up Security work reviews/reduces the existing sites by domain.
    if (sites.length !== BASELINE_INTERPOLATED_QUERY_COUNT) {
      throw new Error(
        `Dynamic SQL inventory changed from ${BASELINE_INTERPOLATED_QUERY_COUNT} sites to ${sites.length}.\n` +
        `Current sites:\n${sites.sort().join('\n')}`
      );
    }

    // Fail immediately on the most dangerous form: direct request/body/query
    // object interpolation inside SQL text. Parameter placeholders and vetted
    // structural fragments still remain in the inventory for deeper review.
    expect(directInputSites).toEqual([]);
  });
});
