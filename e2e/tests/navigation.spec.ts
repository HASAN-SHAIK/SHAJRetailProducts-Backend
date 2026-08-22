import { test, expect } from '@playwright/test';
import { selectors } from '../utils/selectors';

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	await page.fill(selectors.login.email, process.env.ADMIN_EMAIL!);
	await page.fill(selectors.login.password, process.env.ADMIN_PASSWORD!);
	await Promise.all([
		page.waitForURL(/.*dashboard/i),
		page.click(selectors.login.submit)
	]);
}

test.describe('Top-level navigation and buttons', () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test('Navigate to Products and see table and Add button', async ({ page }) => {
		await page.click(selectors.navbar.productsLink);
		await expect(page.locator(selectors.products.table)).toBeVisible();
		await expect(page.locator(selectors.products.addButton)).toBeVisible();

		await page.click(selectors.products.addButton);
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('Dashboard link returns to dashboard', async ({ page }) => {
		await page.click(selectors.navbar.dashboardLink);
		await expect(page.locator(selectors.dashboard.pageTitle)).toBeVisible();
	});
});

