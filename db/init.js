// Создаёт файл базы данных data.db и таблицы, если их ещё нет.
// Заполняет парой примеров, чтобы сразу было что смотреть.

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data.db')
  : path.join(__dirname, '..', 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  is_open INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  image_url TEXT,
  category TEXT NOT NULL DEFAULT 'Прочее',
  is_new INTEGER NOT NULL DEFAULT 0,
  is_promo INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stock (
  product_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, location_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT,
  telegram_username TEXT,
  location_id INTEGER,
  items TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const locCount = db.prepare('SELECT COUNT(*) AS c FROM locations').get().c;

if (locCount === 0) {
  const insertLoc = db.prepare('INSERT INTO locations (name, address, is_open) VALUES (?, ?, 1)');
  const l1 = insertLoc.run('Досы', 'уточните адрес в редактировании точки').lastInsertRowid;
  const l2 = insertLoc.run('Точка на Ленина', 'ул. Ленина, 10').lastInsertRowid;

  const insertProd = db.prepare(`
    INSERT INTO products (name, description, price, image_url, category, is_new, is_promo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const p1 = insertProd.run(
    'Podonki Malasian Pineapple Kiwi', 'Соляная жидкость, 30мл, ананас-киви', 16, '', 'Жидкости', 1, 0
  ).lastInsertRowid;

  const p2 = insertProd.run(
    'ANNIMA Love', 'Соляная жидкость', 350, '', 'Жидкости', 0, 1
  ).lastInsertRowid;

  const insertStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
  insertStock.run(p1, l1, 12);
  insertStock.run(p1, l2, 0);
  insertStock.run(p2, l1, 5);
  insertStock.run(p2, l2, 8);

  console.log('База создана и заполнена демо-данными.');
} else {
  console.log('База уже существует, сидинг пропущен.');
}

module.exports = db;
