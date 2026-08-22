export const selectors = {
	login: {
		email: '[data-testid="login-email"]',
		password: '[data-testid="login-password"]',
		submit: '[data-testid="login-submit"]'
	},
	navbar: {
		dashboardLink: '[data-testid="nav-dashboard"]',
		productsLink: '[data-testid="nav-products"]',
		ordersLink: '[data-testid="nav-orders"]',
		usersLink: '[data-testid="nav-users"]'
	},
	dashboard: {
		pageTitle: '[data-testid="dashboard-title"]'
	},
	products: {
		addButton: '[data-testid="products-add"]',
		table: '[data-testid="products-table"]'
	}
};

