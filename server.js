require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db/init');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';

app.use('/', express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

async function notifyAdmin(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn('BOT_TOKEN или ADMIN_CHAT_ID не заданы — уведомление не отправлено.');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('Telegram API error:', await res.text());
  } catch (err) {
    console.error('Не удалось отправить уведомление в Telegram:', err);
  }
}

app.get('/api/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations ORDER BY id').all());
});

app.get('/api/products', (req, res) => {
  const { location_id, category } = req.query;
  let products = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY id DESC').all();
  if (category) products = products.filter(p => p.category === category);

  const stockStmt = location_id
    ? db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?')
    : db.prepare('SELECT SUM(quantity) AS quantity FROM stock WHERE product_id = ?');

  const withStock = products.map(p => {
    const row = location_id ? stockStmt.get(p.id, location_id) : stockStmt.get(p.id);
    return { ...p, quantity: row?.quantity || 0 };
  });
  res.json(withStock);
});

app.get('/api/products/:id/availability', (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.name, l.address, l.is_open, s.quantity
    FROM stock s JOIN locations l ON l.id = s.location_id
    WHERE s.product_id = ? AND s.quantity > 0
    ORDER BY s.quantity DESC
  `).all(req.params.id);
  res.json(rows);
});

app.post('/api/orders', async (req, res) => {
  const { telegram_user_id, telegram_username, location_id, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  let total = 0;
  const detailedItems = [];
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) continue;
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    total += product.price * qty;
    detailedItems.push({ id: product.id, name: product.name, price: product.price, qty });
  }
  if (detailedItems.length === 0) return res.status(400).json({ error: 'Товары не найдены' });

  const location = location_id ? db.prepare('SELECT * FROM locations WHERE id = ?').get(location_id) : null;

  const insert = db.prepare(`
    INSERT INTO orders (telegram_user_id, telegram_username, location_id, items, total, status)
    VALUES (?, ?, ?, ?, ?, 'new')
  `);
  const result = insert.run(
    telegram_user_id || null, telegram_username || null, location_id || null,
    JSON.stringify(detailedItems), total
  );

  const itemsText = detailedItems.map(i => `• ${i.name} × ${i.qty} — ${i.price * i.qty} ₽`).join('\n');
  const msg = `🆕 <b>Новый заказ #${result.lastInsertRowid}</b>\n` +
    (telegram_username ? `От: @${telegram_username}\n` : '') +
    (location ? `Точка: ${location.name}\n` : '') +
    `\n${itemsText}\n\n<b>Итого: ${total} ₽</b>`;

  await notifyAdmin(msg);
  res.json({ ok: true, order_id: result.lastInsertRowid, total });
});

app.get('/api/orders', (req, res) => {
  const { telegram_user_id } = req.query;
  if (!telegram_user_id) return res.json([]);
  const rows = db.prepare('SELECT * FROM orders WHERE telegram_user_id = ? ORDER BY id DESC').all(telegram_user_id);
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
});

function adminAuth(req, res, next) {
  const pass = req.header('x-admin-password');
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Неверный пароль' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

app.use('/api/admin', adminAuth);

app.get('/api/admin/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations ORDER BY id').all());
});
app.post('/api/admin/locations', (req, res) => {
  const { name, address, is_open } = req.body;
  const r = db.prepare('INSERT INTO locations (name, address, is_open) VALUES (?, ?, ?)')
    .run(name, address || '', is_open ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/locations/:id', (req, res) => {
  const { name, address, is_open } = req.body;
  db.prepare('UPDATE locations SET name=?, address=?, is_open=? WHERE id=?')
    .run(name, address || '', is_open ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/locations/:id', (req, res) => {
  db.prepare('DELETE FROM locations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all());
});
app.post('/api/admin/products', (req, res) => {
  const { name, description, price, image_url, category, is_new, is_promo } = req.body;
  const r = db.prepare(`
    INSERT INTO products (name, description, price, image_url, category, is_new, is_promo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || '', price, image_url || '', category || 'Прочее', is_new ? 1 : 0, is_promo ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/products/:id', (req, res) => {
  const { name, description, price, image_url, category, is_new, is_promo, is_active } = req.body;
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, image_url=?, category=?, is_new=?, is_promo=?, is_active=?
    WHERE id=?
  `).run(name, description || '', price, image_url || '', category || 'Прочее', is_new ? 1 : 0, is_promo ? 1 : 0, is_active === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/admin/stock', (req, res) => {
  const { product_id, location_id, quantity } = req.body;
  db.prepare(`
    INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)
    ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = excluded.quantity
  `).run(product_id, location_id, quantity);
  res.json({ ok: true });
});
app.get('/api/admin/stock', (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, p.name AS product_name, l.name AS location_name
    FROM stock s
    JOIN products p ON p.id = s.product_id
    JOIN locations l ON l.id = s.location_id
  `).all());
});

app.get('/api/admin/orders', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
});
app.put('/api/admin/orders/:id/status', (req, res) => {
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
