const fs = require('fs');
const path = require('path');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

const BASELINE_INTERPOLATED_QUERY_COUNT = 79;
const readSource = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

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

  test('caller-influenced SQL identifiers are allowlisted or internally generated', () => {
    const sharedSort = readSource('src/api/v1/shared/utils/sort.js');
    const customerService = readSource('src/api/v1/modules/customers/customer.service.js');
    const productService = readSource('src/api/v1/modules/products/product.service.js');
    const tenantProductController = readSource('src/controllers/tenant/productController.js');
    const productController = readSource('src/controllers/productController.js');
    const orderController = readSource('src/controllers/orderController.js');
    const dataQualityService = readSource('src/services/dataQualityService.js');
    const tenantProvisionService = readSource('src/services/tenantProvisionService.js');

    // Shared V1 repository sorting converts request keys through a fixed map and
    // collapses order to the only two legal SQL keywords.
    expect(sharedSort).toContain("const order = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';");
    expect(sharedSort).toContain('const column = allowed[sortKey] || fallback.column;');
    expect(customerService).toContain('parseSort(query, SORTABLE');
    expect(productService).toContain('parseSort(query, SORTABLE');

    // Legacy product/order read paths that still interpolate ORDER BY identifiers
    // independently use fixed allowlists and ASC/DESC normalization before SQL.
    expect(tenantProductController).toContain('const allowedSorts = new Set([');
    expect(tenantProductController).toContain("sort = allowedSorts.has(normalized) ? normalized : 'name';");
    expect(productController).toContain('const allowedSorts = {');
    expect(productController).toContain("const resolvedSort = allowedSorts[sortKey] || 'created_at';");
    expect(productController).toContain("const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';");
    expect(orderController).toContain("const allowedSorts = new Set(['id', 'created_at', 'total_amount', 'total_paid', 'balance']);");
    expect(orderController).toContain("const resolvedSort = allowedSorts.has(sortKey) ? sortKey : 'created_at';");
    expect(orderController).toContain("const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';");

    // The only dynamic table identifier in the support backup path iterates a
    // source-owned fixed table allowlist; request data cannot choose a table.
    expect(dataQualityService).toContain("const tables = ['products', 'batches', 'customers', 'orders', 'order_items', 'transactions', 'suppliers', 'expenses'];");
    expect(dataQualityService).toContain('pool.query(`SELECT * FROM ${table} ORDER BY 1 ASC`)');

    // PostgreSQL CREATE/DROP DATABASE cannot parameterize identifiers. Tenant
    // provisioning therefore generates the name internally and quotes embedded
    // double quotes before structural interpolation; caller input is not used.
    expect(tenantProvisionService).toContain('const dbName = `shaj_tenant_${Date.now()}`;');
    expect(tenantProvisionService).toContain('const dbIdentifier = quoteIdentifier(dbName);');
    expect(tenantProvisionService).toContain("const escaped = String(value).replace(/\"/g, '\"\"');");
    expect(tenantProvisionService).toContain('await adminPool.query(`CREATE DATABASE ${dbIdentifier}`);');
    expect(tenantProvisionService).toContain('await adminPool.query(`DROP DATABASE IF EXISTS ${dbIdentifier}`);');
  });
});
