const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');

const {
  register,
  login,
  deleteUser,
  logout,
  getLogin
} = require('../src/controllers/authController');

jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('../src/db', () => ({
  query: jest.fn()
}));

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

describe('authController unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.TOKEN_EXPIRY = '3600';
    process.env.NODE_ENV = 'test';
  });

  describe('register', () => {
    it('returns 400 when user already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      const req = { body: { name: 'Test', email: 'test@example.com', password: 'pw', role: 'admin' } };
      const res = buildRes();

      await register(req, res);

      expect(pool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE email = $1', ['test@example.com']);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'User already exists' });
    });

    it('creates user and returns 201 with user payload', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 2, name: 'Test', email: 'test@example.com', role: 'admin' }]
        });
      bcrypt.hash.mockResolvedValueOnce('hashed_pw');

      const req = { body: { name: 'Test', email: 'test@example.com', password: 'pw', role: 'admin' } };
      const res = buildRes();

      await register(req, res);

      expect(bcrypt.hash).toHaveBeenCalledWith('pw', 10);
      expect(pool.query).toHaveBeenCalledWith(
        'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
        ['Test', 'test@example.com', 'hashed_pw', 'admin']
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'User registered',
        user: { id: 2, name: 'Test', email: 'test@example.com', role: 'admin' }
      });
    });

    it('returns 500 on db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { body: { name: 'Test', email: 'test@example.com', password: 'pw', role: 'admin' } };
      const res = buildRes();

      await register(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'db fail' });
    });
  });

  describe('getLogin', () => {
    it('returns 401 when no token cookie', async () => {
      const req = { cookies: {} };
      const res = buildRes();

      await getLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not authenticated' });
    });

    it('returns 403 when token invalid', async () => {
      jwt.verify.mockImplementationOnce(() => {
        throw new Error('invalid token');
      });

      const req = { cookies: { token: 'bad' } };
      const res = buildRes();

      await getLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
    });

    it('returns decoded user when token valid', async () => {
      jwt.verify.mockReturnValueOnce({ id: 1, role: 'admin' });
      const req = { cookies: { token: 'good' } };
      const res = buildRes();

      await getLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ user: { id: 1, role: 'admin' } });
    });
  });

  describe('login', () => {
    it('returns 401 when user not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const req = { body: { email: 'nope@example.com', password: 'pw', device_id: 'dev1' } };
      const res = buildRes();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid email or password' });
    });

    it('returns 401 when password invalid', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, password: 'hash', device_id: 'dev1' }] });
      bcrypt.compare.mockResolvedValueOnce(false);

      const req = { body: { email: 'a@b.com', password: 'bad', device_id: 'dev1' } };
      const res = buildRes();

      await login(req, res);

      expect(bcrypt.compare).toHaveBeenCalledWith('bad', 'hash');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid email or password' });
    });

    it('binds device on first login and returns token', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'User', role: 'admin', email: 'a@b.com', password: 'hash', device_id: null }] })
        .mockResolvedValueOnce({ rows: [] });
      bcrypt.compare.mockResolvedValueOnce(true);
      jwt.sign.mockReturnValueOnce('signed-token');

      const req = { body: { email: 'a@b.com', password: 'pw', device_id: 'dev1' } };
      const res = buildRes();

      await login(req, res);

      expect(pool.query).toHaveBeenCalledWith('UPDATE users SET device_id = $1 WHERE id = $2', ['dev1', 1]);
      expect(jwt.sign).toHaveBeenCalledWith(
        { id: 1, role: 'admin', user_name: 'User' },
        'test-secret',
        { expiresIn: 3600 * 1000 }
      );
      expect(res.cookie).toHaveBeenCalledWith('token', 'signed-token', {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        maxAge: 3600 * 1000
      });
      expect(res.json).toHaveBeenCalledWith({
        token: 'signed-token',
        user: { id: 1, name: 'User', email: 'a@b.com', role: 'admin' }
      });
    });

    it('rejects login from different device', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'User', role: 'admin', email: 'a@b.com', password: 'hash', device_id: 'dev1' }] });
      bcrypt.compare.mockResolvedValueOnce(true);

      const req = { body: { email: 'a@b.com', password: 'pw', device_id: 'dev2' } };
      const res = buildRes();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: 'This account is already registered on another computer\nPlease contact admin for access.'
      });
    });

    it('returns 500 on unexpected error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { body: { email: 'a@b.com', password: 'pw', device_id: 'dev1' } };
      const res = buildRes();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'db fail' });
    });
  });

  describe('deleteUser', () => {
    it('returns 401 when user not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const req = { body: { email: 'missing@example.com' } };
      const res = buildRes();

      await deleteUser(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid email or password' });
    });

    it('deletes user and returns 204', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });
      const req = { body: { email: 'test@example.com' } };
      const res = buildRes();

      await deleteUser(req, res);

      expect(pool.query).toHaveBeenCalledWith('delete from users where email = $1', ['test@example.com']);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.json).toHaveBeenCalledWith({ message: 'User Deleted' });
    });

    it('returns 500 on error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { body: { email: 'test@example.com' } };
      const res = buildRes();

      await deleteUser(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'db fail' });
    });
  });

  describe('logout', () => {
    it('clears token cookie and returns success', async () => {
      const req = {};
      const res = buildRes();

      await logout(req, res);

      expect(res.clearCookie).toHaveBeenCalledWith('token', {
        httpOnly: true,
        secure: false,
        sameSite: 'Strict'
      });
      expect(res.json).toHaveBeenCalledWith({ message: 'Logout Successful' });
    });

    it('returns 500 when clearCookie throws', async () => {
      const req = {};
      const res = buildRes();
      res.clearCookie.mockImplementationOnce(() => {
        throw new Error('cookie fail');
      });

      await logout(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });
  });
});
