const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createReadinessHandler } = require('./services/readiness');

describe('V1 Central health and readiness boundary', () => {
  const createApp = (masterPool) => {
    const app = express();
    const handleReady = createReadinessHandler(masterPool);
    app.get('/ready', handleReady);
    app.get('/api/ready', handleReady);
    return app;
  };

  test.each(['/ready', '/api/ready'])('returns ready only when required PostgreSQL dependency is available at %s', async (routePath) => {
    const masterPool = { query: jest.fn().mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) };
    const response = await request(createApp(masterPool)).get(routePath);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(masterPool.query).toHaveBeenCalledWith('SELECT 1');
  });

  test.each(['/ready', '/api/ready'])('fails closed without leaking database details at %s', async (routePath) => {
    const masterPool = {
      query: jest.fn().mockRejectedValueOnce(
        new Error('password=secret postgresql://admin:secret@db.internal:5432/master')
      ),
    };
    const response = await request(createApp(masterPool)).get(routePath);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'database_unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(JSON.stringify(response.body)).not.toContain('db.internal');
  });

  test('keeps readiness and liveness routes wired independently in the production app', () => {
    const appSource = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');

    expect(appSource).toContain("app.get('/health', handleHealth)");
    expect(appSource).toContain("app.get('/api/health', handleHealth)");
    expect(appSource).toContain("const handleReady = createReadinessHandler(masterPool)");
    expect(appSource).toContain("app.get('/ready', handleReady)");
    expect(appSource).toContain("app.get('/api/ready', handleReady)");
  });

  test('keeps database warmup authorization in front of the health query', () => {
    const appSource = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
    const authIndex = appSource.indexOf('if (!isWarmupAuthorized(req))');
    const warmupIndex = appSource.indexOf('await performHealthWarmup()');

    expect(authIndex).toBeGreaterThan(-1);
    expect(warmupIndex).toBeGreaterThan(authIndex);
  });
});
