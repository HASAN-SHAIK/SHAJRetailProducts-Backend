const { getTokenFromRequest } = require('../src/utils/jwt');

describe('jwt utils', () => {
  describe('getTokenFromRequest', () => {
    it('uses a valid bearer token from header', () => {
      const req = {
        headers: { authorization: 'Bearer header-token' },
        cookies: { token: 'cookie-token' }
      };
      expect(getTokenFromRequest(req, 'token')).toBe('header-token');
    });

    it('falls back to cookie token when bearer header is undefined string', () => {
      const req = {
        headers: { authorization: 'Bearer undefined' },
        cookies: { token: 'cookie-token' }
      };
      expect(getTokenFromRequest(req, 'token')).toBe('cookie-token');
    });

    it('falls back to cookie token when bearer header is null string', () => {
      const req = {
        headers: { authorization: 'Bearer null' },
        cookies: { token: 'cookie-token' }
      };
      expect(getTokenFromRequest(req, 'token')).toBe('cookie-token');
    });
  });
});
