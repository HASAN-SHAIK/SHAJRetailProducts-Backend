const fs = require('fs');
const path = require('path');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

const BASELINE_INTERPOLATED_QUERY_COUNT = 79;
const readSource = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const REVIEWED_STRUCTURAL_EXPRESSION_PATTERNS = [
  /^(dedupeExpr|whereClause|where|branchClause|branchFilterClause|dateFilterOrders|returnedQuantityJoin)$/,
  /^(productNameSql|productIdentitySql|categoryIdSql|categoryNameSql|revenueSql|netQuantitySql|locationPredicate)$/,
  /^(barcodeSelect|sort|sortBy|sortColumn|sortOrder|resolvedSort|resolvedAt|whereSql|table|dbIdentifier|placeholders)$/,
  /^(branchA|branchB)$/,
  /^(params|values|shopValues|listParams|updateValues)\.length(?:\s*[+-]\s*\d+)?$/,
  /^idx(?:\s*\+\s*\d+)?$/,
  /^(updates|shopUpdates|insertColumns|columns|updateFields|fields)\.join\(', '\)$/,
  /^(where|conditions)\.join\(' AND '\)$/,
  /^placeholders\.join\(', '\)$/,
  /^status \? '\$[123]' : '\$[123]'$/,
];

const collectDynamicQueryInventory = () => {
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

  return { sites, directRequestSites, expressionsBySite };
};

describe('V1 dynamic SQL inventory', () => {
  test('template-interpolated query inventory cannot grow silently', () => {
    const { sites, directRequestSites, expressionsBySite } = collectDynamicQueryInventory();

    if (sites.length !== BASELINE_INTERPOLATED_QUERY_COUNT) {
      throw new Error(
        `Dynamic SQL inventory changed from ${BASELINE_INTERPOLATED_QUERY_COUNT} sites to ${sites.length}.\n` +
        `Current sites:\n${sites.sort().join('\n')}`
      );
    }

    console.log('V1_DYNAMIC_SQL_EXPRESSIONS', JSON.stringify(expressionsBySite));

    // Direct HTTP request-object interpolation is never an acceptable V1 query
    // structure. Request values must remain PostgreSQL parameters.
    expect(directRequestSites).toEqual([]);
  });

  test('all existing structural interpolation expressions have an explicit V1 disposition', () => {
    const { expressionsBySite } = collectDynamicQueryInventory();
    const unreviewed = [];

    for (const { site, expressions } of expressionsBySite) {
      for (const expression of expressions) {
        if (!REVIEWED_STRUCTURAL_EXPRESSION_PATTERNS.some((pattern) => pattern.test(expression))) {
          unreviewed.push({ site, expression });
        }
      }
    }

    // The reviewed families are source-owned WHERE/JOIN/SELECT fragments,
    // parameter-position arithmetic, fixed update-field lists, schema-capability
    // fragments, or the separately certified identifier families below. This
    // gate prevents a new interpolation shape from hiding behind the same site
    // count and forces a fresh Security disposition.
    expect(unreviewed).toEqual([]);
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

    expect(sharedSort).toContain("const order = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';");
    expect(sharedSort).toContain('const column = allowed[sortKey] || fallback.column;');
    expect(customerService).toContain('parseSort(query, SORTABLE');
    expect(productService).toContain('parseSort(query, SORTABLE');

    expect(tenantProductController).toContain('const allowedSorts = new Set([');
    expect(tenantProductController).toContain("sort = allowedSorts.has(normalized) ? normalized : 'name';");
    expect(productController).toContain('const allowedSorts = {');
    expect(productController).toContain("const resolvedSort = allowedSorts[sortKey] || 'created_at';");
    expect(productController).toContain("const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';");
    expect(orderController).toContain("const allowedSorts = new Set(['id', 'created_at', 'total_amount', 'total_paid', 'balance']);");
    expect(orderController).toContain("const resolvedSort = allowedSorts.has(sortKey) ? sortKey : 'created_at';");
    expect(orderController).toContain("const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';");

    expect(dataQualityService).toContain("const tables = ['products', 'batches', 'customers', 'orders', 'order_items', 'transactions', 'suppliers', 'expenses'];");
    expect(dataQualityService).toContain('pool.query(`SELECT * FROM ${table} ORDER BY 1 ASC`)');

    expect(tenantProvisionService).toContain('const dbName = `shaj_tenant_${Date.now()}`;');
    expect(tenantProvisionService).toContain('const dbIdentifier = quoteIdentifier(dbName);');
    expect(tenantProvisionService).toContain("const escaped = String(value).replace(/\"/g, '\"\"');");
    expect(tenantProvisionService).toContain('await adminPool.query(`CREATE DATABASE ${dbIdentifier}`);');
    expect(tenantProvisionService).toContain('await adminPool.query(`DROP DATABASE IF EXISTS ${dbIdentifier}`);');
  });
});
