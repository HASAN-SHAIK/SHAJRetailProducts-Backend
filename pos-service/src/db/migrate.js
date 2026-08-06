const fs = require('node:fs');
const path = require('node:path');
const { getDatabase } = require('./database');

function migrate() {
  const db = getDatabase();
  const dir = path.join(__dirname, 'migrations');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const apply = db.transaction((file) => {
    db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
  });
  for (const file of files) if (!applied.has(file)) apply(file);
  return files.filter(file => !applied.has(file));
}

if (require.main === module) console.log(JSON.stringify({ applied: migrate() }, null, 2));
module.exports = { migrate };
