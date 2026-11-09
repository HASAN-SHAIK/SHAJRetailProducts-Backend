const puppeteer = require('puppeteer');

const RETAIL_HUB_URL = 'http://localhost:4173';
const CREDENTIALS = {
  email: 'admin@ameena.com',
  password: 'Password@123',
};

const pagesToTest = [
  { path: '/', name: 'Overview / Executive Console' },
  { path: '/analytics/sales', name: 'Sales Revenue Analytics' },
  { path: '/analytics/profit-growth', name: 'Profit & Growth Analytics' },
  { path: '/analytics/inventory', name: 'Inventory Analytics' },
  { path: '/analytics/products-categories', name: 'Product & Category Analytics' },
  { path: '/analytics/customers-credit', name: 'Customer Credit Analytics' },
  { path: '/analytics/branches', name: 'Branch Performance Analytics' },
  { path: '/analytics/smart-insights', name: 'Smart Insights' },
  { path: '/customers', name: 'Customers Directory' },
  { path: '/orders', name: 'Orders List' },
  { path: '/orders/sales', name: 'Sales Orders' },
  { path: '/orders/purchases', name: 'Purchase Orders' },
  { path: '/staff', name: 'Staff Directory' },
  { path: '/staff/new', name: 'Add Staff Member' },
  { path: '/staff/salary', name: 'Staff Salary Management' },
  { path: '/staff/branch-assignment', name: 'Staff Store Assignment' },
  { path: '/staff/roles-status', name: 'Staff Roles & Status' },
  { path: '/expenses', name: 'Expenses Ledger' },
  { path: '/accounts', name: 'Accounting & Ledgers' },
  { path: '/business', name: 'Business Settings & Profile' },
  { path: '/stores', name: 'Stores & Branches' },
  { path: '/devices', name: 'POS Terminals & Devices' },
  { path: '/offline-sync', name: 'Offline Sync Center' },
  { path: '/configuration', name: 'Configuration Matrix' },
  { path: '/configuration/audit', name: 'Configuration Audit Trail' },
  { path: '/inventory/catalog', name: 'Product Catalog' },
  { path: '/inventory/purchases', name: 'Purchase Book' },
  { path: '/inventory/suppliers', name: 'Suppliers Directory' },
];

async function run() {
  console.log('🚀 Launching Headless Browser for Retail Hub testing...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore favicon or non-critical asset warnings
      if (!text.includes('favicon.ico')) {
        errors.push(`[Console Error] ${text}`);
      }
    }
  });

  page.on('pageerror', (err) => {
    errors.push(`[Page Crash] ${err.message}`);
  });

  try {
    console.log(`🌐 Navigating to ${RETAIL_HUB_URL}...`);
    await page.goto(RETAIL_HUB_URL, { waitUntil: 'networkidle2', timeout: 15000 });

    console.log('🔑 Logging in with admin@ameena.com...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', CREDENTIALS.email);
    await page.type('input[type="password"]', CREDENTIALS.password);
    await page.click('button.primary-btn');

    // Wait for authentication to settle and redirect to shell
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    const loggedIn = await page.evaluate(() => {
      return !document.querySelector('form.login-form');
    });

    if (!loggedIn) {
      const errorText = await page.evaluate(() => document.querySelector('.alert.danger')?.innerText || 'Unknown');
      throw new Error(`Login failed on Retail Hub: ${errorText}`);
    }
    console.log('✅ Successfully signed in to Retail Hub!');

    console.log('\n--- Auditing Pages ---');
    const results = [];

    for (const item of pagesToTest) {
      const pageErrors = [];
      const tempErrorHandler = (err) => pageErrors.push(err.message);
      page.on('pageerror', tempErrorHandler);

      try {
        const url = `${RETAIL_HUB_URL}${item.path}`;
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise((r) => setTimeout(r, 800)); // allow React render

        const pageTitle = await page.evaluate(() => {
          return document.querySelector('h1, h2, .panel-title, .brand-mark')?.innerText?.trim() || document.title || 'Rendered';
        });

        const status = response ? response.status() : 'OK';
        const hasFatalError = pageErrors.length > 0;

        results.push({
          path: item.path,
          name: item.name,
          status,
          heading: pageTitle.replace(/\n+/g, ' - ').slice(0, 40),
          success: !hasFatalError && status < 400,
          errors: pageErrors,
        });

        const statusIcon = !hasFatalError && status < 400 ? '✅' : '❌';
        console.log(`${statusIcon} ${item.path.padEnd(30)} | ${item.name.padEnd(32)} | Status: ${status}`);
      } catch (err) {
        results.push({
          path: item.path,
          name: item.name,
          status: 'TIMEOUT / FAILED',
          success: false,
          errors: [err.message],
        });
        console.log(`❌ ${item.path.padEnd(30)} | ${item.name.padEnd(32)} | Error: ${err.message}`);
      } finally {
        page.off('pageerror', tempErrorHandler);
      }
    }

    const successful = results.filter((r) => r.success).length;
    console.log(`\n📊 Retail Hub Audit Summary: ${successful}/${results.length} pages working properly.`);
    return { results, total: results.length, successful };
  } finally {
    await browser.close();
  }
}

run()
  .then((report) => {
    process.exit(report.successful === report.total ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal audit failure:', err);
    process.exit(1);
  });
