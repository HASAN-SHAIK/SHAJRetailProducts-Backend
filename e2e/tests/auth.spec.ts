import { test, expect } from '@playwright/test';
import { selectors } from '../utils/selectors';

test.describe('Authentication', () => {
	test('Admin can log in and see dashboard', async ({ page }) => {
		const email = process.env.ADMIN_EMAIL!;
		const password = process.env.ADMIN_PASSWORD!;

		await page.goto('/login');
		await page.fill(selectors.login.email, email);
		await page.fill(selectors.login.password, password);
		await Promise.all([
			page.waitForURL(/.*dashboard/i),
			page.click(selectors.login.submit)
		]);

		await expect(page.locator(selectors.dashboard.pageTitle)).toBeVisible();
	});
});

