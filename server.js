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
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
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

// ---------- ПУБЛИЧНОЕ API ----------

app.get('/api/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations ORDER BY id').all());
});

app.get('/api/banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY sort_order ASC, id ASC').all());
});

// Список линеек (для категории или всех), с обложкой (картинка линейки или первого товара в ней)
app.get('/api/lines', (req, res) => {
  const { category } = req.query;
  let lines = category
    ? db.prepare('SELECT * FROM lines WHERE category = ? ORDER BY id').all(category)
    : db.prepare('SELECT * FROM lines ORDER BY id').all();

  const coverStmt = db.prepare('SELECT image_url FROM products WHERE line_id = ? AND image_url != \'\' LIMIT 1');
  lines = lines.map(l => {
    const cover = l.image_url || coverStmt.get(l.id)?.image_url || '';
    return { ...l, cover_image: cover };
  });
  res.json(lines);
});

// Товары: ?location_id=, ?category=, ?line_id= (число, или "none" — товары без линейки)
app.get('/api/products', (req, res) => {
  const { location_id, category, line_id } = req.query;
  let products = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY id DESC').all();

  if (category) products = products.filter(p => p.category === category);

  if (line_id === 'none') {
    products = products.filter(p => !p.line_id);
  } else if (line_id) {
    products = products.filter(p => p.line_id === Number(line_id));
  }

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

// ---------- АДМИН API ----------

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

// Точки
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

// Линейки
app.get('/api/admin/lines', (req, res) => {
  res.json(db.prepare('SELECT * FROM lines ORDER BY id DESC').all());
});
app.post('/api/admin/lines', (req, res) => {
  const { category, name, image_url } = req.body;
  const r = db.prepare('INSERT INTO lines (category, name, image_url) VALUES (?, ?, ?)')
    .run(category || 'Прочее', name, image_url || '');
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/admin/lines/:id', (req, res) => {
  db.prepare('DELETE FROM lines WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Товары
app.get('/api/admin/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  const lines = db.prepare('SELECT id, name FROM lines').all();
  const lineMap = Object.fromEntries(lines.map(l => [l.id, l.name]));
  res.json(products.map(p => ({ ...p, line_name: p.line_id ? lineMap[p.line_id] || '' : '' })));
});
app.post('/api/admin/products', (req, res) => {
  const { name, description, price, image_url, category, line_id, is_new, is_promo } = req.body;
  const r = db.prepare(`
    INSERT INTO products (name, description, price, image_url, category, line_id, is_new, is_promo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || '', price, image_url || '', category || 'Прочее', line_id || null, is_new ? 1 : 0, is_promo ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/products/:id', (req, res) => {
  const { name, description, price, image_url, category, line_id, is_new, is_promo, is_active } = req.body;
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, image_url=?, category=?, line_id=?, is_new=?, is_promo=?, is_active=?
    WHERE id=?
  `).run(name, description || '', price, image_url || '', category || 'Прочее', line_id || null, is_new ? 1 : 0, is_promo ? 1 : 0, is_active === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Остатки
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

// Баннеры
app.get('/api/admin/banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY sort_order ASC, id ASC').all());
});
app.post('/api/admin/banners', (req, res) => {
  const { badge, title, subtitle, image_url, sort_order } = req.body;
  const r = db.prepare('INSERT INTO banners (badge, title, subtitle, image_url, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(badge || '', title, subtitle || '', image_url || '', sort_order || 0);
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/admin/banners/:id', (req, res) => {
  db.prepare('DELETE FROM banners WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Заказы
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
