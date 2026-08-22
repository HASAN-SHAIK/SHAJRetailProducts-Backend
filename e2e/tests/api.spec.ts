import { test, expect } from '@playwright/test';

test.describe('Backend API sanity checks', () => {
	test('GET /admin/users returns list', async ({ request }) => {
		const apiBase = process.env.API_BASE_URL || '';
		const res = await request.get(`${apiBase}/admin/users`, {
			headers: { Accept: 'application/json' }
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
	});

	test('POST /auth/login works with admin credentials', async ({ request }) => {
		const apiBase = process.env.API_BASE_URL || '';
		const res = await request.post(`${apiBase}/auth/login`, {
			data: {
				email: process.env.ADMIN_EMAIL,
				password: process.env.ADMIN_PASSWORD
			}
		});
		expect(res.status()).toBeLessThan(400);
		const body = await res.json();
		expect(body).toHaveProperty('token');
	});
});

