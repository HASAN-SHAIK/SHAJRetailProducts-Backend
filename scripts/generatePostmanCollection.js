const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, 'src', 'App.js');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const guessValueForField = (field) => {
  const lower = field.toLowerCase();
  if (lower.includes('email')) return 'user@example.com';
  if (lower.includes('password')) return 'Password123!';
  if (lower.includes('name')) return 'Sample Name';
  if (lower.includes('mobile') || lower.includes('phone')) return '9999999999';
  if (lower.includes('amount') || lower.includes('price') || lower.includes('total') || lower.includes('tax')) return 100.5;
  if (lower.includes('date')) return '2026-03-06';
  if (lower.includes('status')) return 'active';
  if (lower.includes('role')) return 'admin';
  if (lower.includes('id')) return 1;
  if (lower.includes('qty') || lower.includes('quantity')) return 1;
  if (lower.includes('address')) return '123 Main St';
  if (lower.includes('gst')) return '29ABCDE1234F2Z5';
  if (lower.includes('url')) return 'https://example.com/file';
  if (lower.includes('category')) return 'general';
  if (lower.includes('priority')) return 'medium';
  if (lower.includes('title')) return 'Sample Title';
  if (lower.includes('description') || lower.includes('message')) return 'Sample message';
  return 'sample';
};

const normalizePath = (base, route) => {
  const full = `${base || ''}/${route || ''}`.replace(/\/+/g, '/');
  return full.replace(/\/+/g, '/').replace(/\/+/g, '/').replace(/\/+/g, '/');
};

const cleanPath = (p) => p.replace(/\/+/g, '/').replace(/\/+/g, '/').replace(/\/+/g, '/');

const joinPaths = (a, b) => {
  const base = (a || '').replace(/\/+$/, '');
  const seg = (b || '').replace(/^\/+/, '');
  const combined = `${base}/${seg}`;
  return combined.replace(/\/+/g, '/').replace(/\/+/g, '/');
};

const parseRequireMap = (source) => {
  const map = new Map();
  const re = /const\s+([A-Za-z0-9_]+)\s*=\s*require\(['"]([^'"]+)['"]\);/g;
  let m;
  while ((m = re.exec(source))) {
    map.set(m[1], m[2]);
  }
  return map;
};

const splitArgs = (argsString) => {
  const parts = [];
  let current = '';
  let depth = 0;
  let inString = null;
  for (let i = 0; i < argsString.length; i++) {
    const ch = argsString[i];
    if (inString) {
      current += ch;
      if (ch === inString && argsString[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const parseRouterFile = (filePath, basePath, inheritedMiddlewares, routeAccumulator, controllerCache) => {
  const source = fs.readFileSync(filePath, 'utf8');
  const requireMap = parseRequireMap(source);
  const dir = path.dirname(filePath);

  // router.use(...)
  const useRe = /router\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,([\s\S]*?)\)\s*;/g;
  let um;
  while ((um = useRe.exec(source))) {
    const mountPath = um[2];
    const args = splitArgs(um[3]);
    if (!args.length) continue;
    const lastArg = args[args.length - 1];
    const middlewares = args.slice(0, -1).map(a => a.trim()).filter(Boolean);
    if (requireMap.has(lastArg)) {
      const rel = requireMap.get(lastArg);
      const subFile = path.resolve(dir, rel + (rel.endsWith('.js') ? '' : '.js'));
      parseRouterFile(subFile, joinPaths(basePath, mountPath), inheritedMiddlewares.concat(middlewares), routeAccumulator, controllerCache);
    }
  }

  // router.METHOD(...)
  const methodRe = /router\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2\s*,([\s\S]*?)\)\s*;/g;
  let mm;
  while ((mm = methodRe.exec(source))) {
    const method = mm[1].toUpperCase();
    const routePath = mm[3];
    const args = splitArgs(mm[4]);
    if (!args.length) continue;
    const handler = args[args.length - 1].replace(/\s*\)\s*$/, '').trim();
    const middlewares = inheritedMiddlewares.concat(args.slice(0, -1).map(a => a.trim()).filter(Boolean));
    const handlerInfo = resolveHandler(controllerCache, source, requireMap, handler, dir);

    routeAccumulator.push({
      method,
      path: joinPaths(basePath, routePath),
      middlewares,
      handler,
      controllerPath: handlerInfo.controllerPath,
      fields: handlerInfo.fields
    });
  }
};

const resolveHandler = (controllerCache, routeSource, requireMap, handlerName, routeDir) => {
  let controllerPath = null;
  // Find controller that exports handler: look at destructured requires in the route file
  const destructureRe = /const\s*{\s*([^}]+)\s*}\s*=\s*require\(['"]([^'"]+)['"]\);/g;
  let m;
  while ((m = destructureRe.exec(routeSource))) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (names.includes(handlerName)) {
      controllerPath = path.resolve(routeDir, m[2] + (m[2].endsWith('.js') ? '' : '.js'));
      break;
    }
  }

  let fields = { body: [], query: [], params: [] };
  if (controllerPath && fs.existsSync(controllerPath)) {
    fields = extractHandlerFields(controllerCache, controllerPath, handlerName);
  }

  return { controllerPath, fields };
};

const extractHandlerFields = (controllerCache, controllerPath, handlerName) => {
  const cacheKey = `${controllerPath}::${handlerName}`;
  if (controllerCache.has(cacheKey)) return controllerCache.get(cacheKey);
  const source = fs.readFileSync(controllerPath, 'utf8');
  const body = findFunctionBody(source, handlerName);
  if (!body) {
    const empty = { body: [], query: [], params: [] };
    controllerCache.set(cacheKey, empty);
    return empty;
  }

  const fields = {
    body: new Set(),
    query: new Set(),
    params: new Set()
  };

  const directPatterns = [
    { re: /req\.body\?\.([A-Za-z0-9_]+)/g, type: 'body' },
    { re: /req\.body\.([A-Za-z0-9_]+)/g, type: 'body' },
    { re: /req\.body\[['"]([^'"]+)['"]\]/g, type: 'body' },
    { re: /req\.query\?\.([A-Za-z0-9_]+)/g, type: 'query' },
    { re: /req\.query\.([A-Za-z0-9_]+)/g, type: 'query' },
    { re: /req\.query\[['"]([^'"]+)['"]\]/g, type: 'query' },
    { re: /req\.params\.([A-Za-z0-9_]+)/g, type: 'params' },
    { re: /req\.params\[['"]([^'"]+)['"]\]/g, type: 'params' }
  ];

  for (const { re, type } of directPatterns) {
    let m;
    while ((m = re.exec(body))) {
      if (m[1]) fields[type].add(m[1]);
    }
  }

  const destructurePatterns = [
    { re: /const\s*{\s*([^}]+)\s*}\s*=\s*req\.body(?:\s*\|\|\s*\{\})?/g, type: 'body' },
    { re: /const\s*{\s*([^}]+)\s*}\s*=\s*req\.query(?:\s*\|\|\s*\{\})?/g, type: 'query' },
    { re: /const\s*{\s*([^}]+)\s*}\s*=\s*req\.params(?:\s*\|\|\s*\{\})?/g, type: 'params' }
  ];

  for (const { re, type } of destructurePatterns) {
    let m;
    while ((m = re.exec(body))) {
      const raw = m[1];
      raw.split(',').forEach((part) => {
        const cleaned = part.trim();
        if (!cleaned) return;
        const name = cleaned.split('=')[0].split(':')[0].trim();
        if (name) fields[type].add(name);
      });
    }
  }

  const result = {
    body: Array.from(fields.body),
    query: Array.from(fields.query),
    params: Array.from(fields.params)
  };
  controllerCache.set(cacheKey, result);
  return result;
};

const findFunctionBody = (source, name) => {
  const patterns = [
    new RegExp(`const\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*{`),
    new RegExp(`exports\\.${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*{`)
  ];

  let startIdx = -1;
  let braceIdx = -1;
  for (const re of patterns) {
    const match = re.exec(source);
    if (match) {
      startIdx = match.index + match[0].length - 1;
      braceIdx = source.indexOf('{', match.index);
      break;
    }
  }
  if (braceIdx === -1) return null;

  let depth = 0;
  for (let i = braceIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
      return source.slice(braceIdx, i + 1);
    }
  }
  return null;
};

const parseAppRoutes = () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const requireMap = parseRequireMap(source);
  const routes = [];
  const controllerCache = new Map();

  // app.use
  const useRe = /app\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,([\s\S]*?)\)\s*;/g;
  let um;
  while ((um = useRe.exec(source))) {
    const mountPath = um[2];
    const args = splitArgs(um[3]);
    if (!args.length) continue;
    const lastArg = args[args.length - 1];
    const middlewares = args.slice(0, -1).map(a => a.trim()).filter(Boolean);
    if (requireMap.has(lastArg)) {
      const rel = requireMap.get(lastArg);
      const routerPath = path.resolve(path.dirname(APP_PATH), rel + (rel.endsWith('.js') ? '' : '.js'));
      parseRouterFile(routerPath, mountPath, middlewares, routes, controllerCache);
    }
  }

  // app.METHOD
  const methodRe = /app\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2\s*,([\s\S]*?)\)\s*;/g;
  let mm;
  while ((mm = methodRe.exec(source))) {
    const method = mm[1].toUpperCase();
    const routePath = mm[3];
    const args = splitArgs(mm[4]);
    if (!args.length) continue;
    const handler = args[args.length - 1].replace(/\s*\)\s*$/, '').trim();
    const middlewares = args.slice(0, -1).map(a => a.trim()).filter(Boolean);

    routes.push({
      method,
      path: routePath,
      middlewares,
      handler,
      controllerPath: null,
      fields: { body: [], query: [], params: [] }
    });
  }

  return routes;
};

const determineAuth = (middlewares, path) => {
  const names = middlewares.join(' ');
  if (names.includes('adminAuthMiddleware')) return 'admin';
  if (names.includes('tenantAuthMiddleware') || names.includes('authTenantMiddleware')) return 'tenant';
  // Explicit public auth paths
  if (path.startsWith('/platform/auth') || path.startsWith('/api/auth')) return 'public';
  return 'public';
};

const buildExampleBody = (fields) => {
  if (!fields || !fields.length) return null;
  const body = {};
  fields.forEach((field) => {
    if (field.endsWith('items') || field.endsWith('products') || field === 'items') {
      body[field] = [{ product_id: 1, quantity: 1, price: 10.0 }];
      return;
    }
    if (field === 'addons' || field === 'features') {
      body[field] = { feature: true };
      return;
    }
    body[field] = guessValueForField(field);
  });
  return body;
};

const buildPostmanUrl = (pathStr, queryFields) => {
  const raw = `{{base_url}}${pathStr.startsWith('/') ? '' : '/'}${pathStr}`;
  const pathSegments = pathStr.split('/').filter(Boolean);
  const variables = [];
  pathSegments.forEach((seg) => {
    if (seg.startsWith(':')) {
      variables.push({ key: seg.slice(1), value: guessValueForField(seg.slice(1)) });
    }
  });

  const query = (queryFields || []).map((q) => ({ key: q, value: String(guessValueForField(q)) }));

  return {
    raw,
    host: ['{{base_url}}'],
    path: pathSegments.map((seg) => (seg.startsWith(':') ? `:${seg.slice(1)}` : seg)),
    query: query.length ? query : undefined,
    variable: variables.length ? variables : undefined
  };
};

const determineFolder = (pathStr) => {
  if (pathStr.startsWith('/platform')) return 'Platform';
  if (pathStr.includes('/customers')) return 'Customer';
  if (pathStr.includes('/auth')) return 'Auth';
  if (pathStr.includes('/products')) return 'Products';
  if (pathStr.includes('/orders') || pathStr.includes('/transactions')) return 'Sales';
  if (pathStr.includes('/reports') || pathStr.includes('/dashboard') || pathStr.includes('revenue')) return 'Reports';
  if (
    pathStr.startsWith('/api/tenant') ||
    pathStr.startsWith('/api/banner') ||
    pathStr.startsWith('/api/platform') ||
    pathStr.startsWith('/api/shop-details') ||
    pathStr.startsWith('/api/support')
  ) {
    return 'Admin';
  }
  return 'Admin';
};

const buildCollection = (routes) => {
  const folders = new Map();
  const ensureFolder = (name) => {
    if (!folders.has(name)) folders.set(name, []);
    return folders.get(name);
  };

  routes.forEach((route) => {
    const folderName = determineFolder(route.path);
    const items = ensureFolder(folderName);
    const authType = determineAuth(route.middlewares, route.path);
    const bodyFields = route.fields?.body || [];
    const queryFields = route.fields?.query || [];
    const paramsFields = route.fields?.params || [];

    const allQueryFields = Array.from(new Set([...queryFields, ...paramsFields.filter(p => p && !route.path.includes(`:${p}`))]));

    const url = buildPostmanUrl(route.path, allQueryFields);
    const exampleBody = buildExampleBody(bodyFields);

    const request = {
      method: route.method,
      header: [
        { key: 'Content-Type', value: 'application/json' },
        ...(authType !== 'public' ? [{ key: 'Authorization', value: 'Bearer {{jwt_token}}' }] : []),
        ...(authType !== 'public' && route.path.startsWith('/api') ? [{ key: 'X-Tenant-Id', value: '{{tenant_id}}', description: 'Optional; tenant_id is derived from JWT in backend' }] : [])
      ],
      url,
      description: authType === 'public'
        ? 'Public endpoint'
        : 'Protected endpoint. Tenant context is derived from the JWT; ensure {{tenant_id}} matches your token.',
      ...(exampleBody ? {
        body: {
          mode: 'raw',
          raw: JSON.stringify(exampleBody, null, 2)
        }
      } : {})
    };

    if (route.method === 'GET' || route.method === 'DELETE') {
      delete request.body;
    }

    const responseExample = {
      name: 'Example Response',
      originalRequest: request,
      status: route.method === 'POST' ? 'Created' : 'OK',
      code: route.method === 'POST' ? 201 : 200,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ success: true }, null, 2)
    };

    items.push({
      name: `${route.method} ${route.path}`,
      request,
      response: [responseExample],
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('Status code is 200/201/400/401', function () {",
              '  pm.expect([200, 201, 400, 401]).to.include(pm.response.code);',
              '});'
            ]
          }
        }
      ]
    });
  });

  return {
    info: {
      name: 'SHAJRetail API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: Array.from(folders.entries()).map(([name, items]) => ({
      name,
      item: items
    }))
  };
};

const writeOutputs = (collection) => {
  const outDir = path.join(ROOT, 'postman');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const collectionPath = path.join(outDir, 'SHAJRetail.postman_collection.json');
  fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));

  const env = {
    name: 'SHAJRetail Local',
    values: [
      { key: 'base_url', value: 'http://localhost:5000', enabled: true },
      { key: 'jwt_token', value: '', enabled: true },
      { key: 'tenant_id', value: '', enabled: true }
    ],
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'SHAJRetail Postman Generator'
  };

  const envPath = path.join(outDir, 'SHAJRetail.postman_environment.json');
  fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

  return { collectionPath, envPath };
};

const main = () => {
  const routes = parseAppRoutes();
  const collection = buildCollection(routes);
  const outputs = writeOutputs(collection);
  console.log('Generated:', outputs);
};

main();
