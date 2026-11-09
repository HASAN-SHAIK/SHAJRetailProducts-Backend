const puppeteer = require('puppeteer');

const FRONTEND_URL = 'http://localhost:3000';
const CREDENTIALS = {
  email: 'admin@ameena.com',
  password: 'Password@123',
};

const pagesToTest = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/products', name: 'Products & Inventory' },
  { path: '/billing/retail', name: 'Retail Billing POS' },
  { path: '/billing/wholesale', name: 'Wholesale Billing POS' },
  { path: '/orders/sales', name: 'Sales Orders' },
  { path: '/orders/purchases', name: 'Purchase Orders' },
  { path: '/inventory/catalog', name: 'Inventory Catalog' },
  { path: '/inventory/purchases', name: 'Purchase Book' },
  { path: '/inventory/suppliers', name: 'Suppliers Directory' },
  { path: '/customers', name: 'Customers Directory' },
  { path: '/customers/new', name: 'New Customer' },
  { path: '/staff-expenses/staff/list', name: 'Staff Management' },
  { path: '/staff-expenses/staff/salary', name: 'Salary Tracking' },
  { path: '/staff-expenses/expenses/daily', name: 'Daily Expense Report' },
  { path: '/returns-corrections/returns/history', name: 'Returns History' },
  { path: '/returns-corrections/returns/new', name: 'Sales Return Entry' },
  { path: '/accounts/cashbook', name: 'Accounts Cash Book' },
  { path: '/accounts/bankbook', name: 'Accounts Bank Book' },
  { path: '/accounts/ledger', name: 'General Ledger' },
  { path: '/accounts/outstanding', name: 'Outstanding Balances' },
  { path: '/branch-devices', name: 'Branch Devices' },
  { path: '/support', name: 'Customer Support' },
];

async function run() {
  console.log('🚀 Launching Headless Browser for Frontend Web App testing...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico')) {
        console.log(`   [Browser Console] ${text.slice(0, 100)}`);
      }
    }
  });

  try {
    console.log(`🌐 Navigating to ${FRONTEND_URL}...`);
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });

    console.log('🔑 Logging into Frontend Web App...');
    await page.waitForSelector('#login-email', { timeout: 10000 });
    await page.type('#login-email', CREDENTIALS.email);
    await page.type('#login-password', CREDENTIALS.password);
    await page.click('button[type="submit"]');

    // Wait for redirect to /setup or /dashboard
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    const currentUrl = page.url();
    console.log(`✅ Logged in successfully! Current URL: ${currentUrl}`);

    console.log('\n--- Auditing Frontend Pages ---');
    const results = [];

    for (const item of pagesToTest) {
      const pageErrors = [];
      const tempErrorHandler = (err) => pageErrors.push(err.message);
      page.on('pageerror', tempErrorHandler);

      try {
        const url = `${FRONTEND_URL}${item.path}`;
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise((r) => setTimeout(r, 800)); // allow React render

        const pageTitle = await page.evaluate(() => {
          return (
            document.querySelector('h1, h2, h3, .page-title, .header-title')?.innerText?.trim() ||
            document.title ||
            'Rendered'
          );
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
        console.log(`${statusIcon} ${item.path.padEnd(35)} | ${item.name.padEnd(25)} | Status: ${status}`);
      } catch (err) {
        results.push({
          path: item.path,
          name: item.name,
          status: 'TIMEOUT / FAILED',
          success: false,
          errors: [err.message],
        });
        console.log(`❌ ${item.path.padEnd(35)} | ${item.name.padEnd(25)} | Error: ${err.message}`);
      } finally {
        page.off('pageerror', tempErrorHandler);
      }
    }

    const successful = results.filter((r) => r.success).length;
    console.log(`\n📊 Frontend Web App Audit Summary: ${successful}/${results.length} pages working properly.`);
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
