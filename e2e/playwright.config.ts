import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

export default defineConfig({
	testDir: 'tests',
	timeout: 30000,
	expect: { timeout: 5000 },
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
	use: {
		baseURL: process.env.BASE_URL || 'http://localhost:3000',
		trace: 'on-first-retry',
		video: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 10000,
		navigationTimeout: 15000
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
		// Add more browsers if needed: firefox, webkit
	]
});

