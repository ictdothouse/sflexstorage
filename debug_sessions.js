const path = require('path');
const Database = require('better-sqlite3');

// Check main DB
try {
  const db = new Database(path.join(__dirname, 'database', 'photovault.db'));
  const users = db.prepare('SELECT id, username, email, role FROM users').all();
  console.log('=== USERS ===');
  console.log(JSON.stringify(users, null, 2));
  db.close();
} catch(e) { console.error('Main DB error:', e.message); }

// Check sessions DB
try {
  const sessionDbPath = path.join(__dirname, 'database', 'sessions.sqlite');
  const sdb = new Database(sessionDbPath);
  const tables = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('=== SESSION TABLES ===', JSON.stringify(tables));
  if (tables.length > 0) {
    const sessions = sdb.prepare('SELECT sid, expired FROM sessions').all();
    console.log('=== SESSIONS COUNT ===', sessions.length);
    sessions.forEach(s => console.log('  sid:', s.sid.substring(0,20)+'...', '| expired:', new Date(s.expired * 1000).toISOString()));
  }
  sdb.close();
} catch(e) { console.error('Sessions DB error:', e.message); }
