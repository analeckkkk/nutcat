const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const tgUser = tg?.initDataUnsafe?.user || null;

let state = {
  tab: 'shops',
  locations: [],
  selectedLocationId: null,
  selectedCategory: null,
  selectedLineId: null,
  products: [],
  cart: {},
};

const app = document.getElementById('app');

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error('Ошибка запроса: ' + path);
  return res.json();
}

function money(n) { return `${n} ₽`; }

async function renderShops() {
  const [locations, banners] = await Promise.all([api('/locations'), api('/banners')]);
  state.locations = locations;

  app.innerHTML = `
    <div class="banner-carousel" id="bannerCarousel"></div>
    <div class="section-title">Наши магазины</div>
    <div id="shopList"></div>
    <button class="btn-outline" id="openCatalogBtn">Открыть общий каталог</button>
  `;

  const carousel = document.getElementById('bannerCarousel');
  if (banners.length === 0) {
    carousel.innerHTML = `
      <div class="banner">
        <div class="badge">⭐ ТОВАР ДНЯ</div>
        <div class="name">Загляните в каталог</div>
        <div class="price">Свежие поступления каждую неделю</div>
      </div>
    `;
  } else {
    carousel.innerHTML = banners.map(b => `
      <div class="banner">
        ${b.badge ? `<div class="badge">${b.badge}</div>` : ''}
        <div class="name">${b.title}</div>
        <div class="price">${b.subtitle || ''}</div>
      </div>
    `).join('');
  }

  const list = document.getElementById('shopList');
  locations.forEach(loc => {
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `
      <div>
        <div class="shop-name">${loc.name}</div>
        <div class="status"><span class="dot">●</span> ${loc.is_open ? 'Открыт' : 'Закрыт'}</div>
        ${loc.address ? `<div class="status">${loc.address}</div>` : ''}
      </div>
      <div>›</div>
    `;
    row.onclick = () => { state.selectedLocationId = loc.id; switchTab('catalog'); };
    list.appendChild(row);
  });

  document.getElementById('openCatalogBtn').onclick = () => {
    state.selectedLocationId = null;
    switchTab('catalog');
  };
}

async function renderCatalog() {
  state.selectedLineId = null;
  const qs = state.selectedLocationId ? `?location_id=${state.selectedLocationId}` : '';
  const allProducts = await api('/products' + qs);
  const lines = await api('/lines');

  const categories = [...new Set(allProducts.map(p => p.category))];
  if (!state.selectedCategory && categories.length) state.selectedCategory = categories[0];

  const locName = state.selectedLocationId
    ? state.locations.find(l => l.id === state.selectedLocationId)?.name
    : 'Все точки';

  app.innerHTML = `
    <h1 class="page-title">Каталог</h1>
    <div class="chip">📍 ${locName}</div>
    <div id="catTabs" style="margin:12px 0; display:flex; gap:8px; overflow-x:auto;"></div>
    <div id="linesRow"></div>
    <div id="productList" style="margin-top:14px;"></div>
  `;

  const catTabs = document.getElementById('catTabs');
  categories.forEach(cat => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.style.cursor = 'pointer';
    b.style.border = cat === state.selectedCategory ? '1px solid #a488ff' : 'none';
    b.textContent = cat;
    b.onclick = () => { state.selectedCategory = cat; renderCatalog(); };
    catTabs.appendChild(b);
  });

  const catLines = lines.filter(l => l.category === state.selectedCategory);
  const linesRow = document.getElementById('linesRow');
  if (catLines.length > 0) {
    linesRow.innerHTML = catLines.map(l => `
      <div class="line-card" data-line="${l.id}">
        <div class="line-thumb"></div>
        <div class="line-name">${l.name}</div>
        <div class="line-cta">Смотреть вкусы →</div>
      </div>
    `).join('');
    linesRow.querySelectorAll('.line-card').forEach(card => {
      card.onclick = () => { state.selectedLineId = Number(card.dataset.line); renderLineProducts(); };
    });
  } else {
    linesRow.innerHTML = '';
  }

  const directProducts = allProducts.filter(p => p.category === state.selectedCategory && !p.line_id);
  state.products = allProducts;
  renderProductList(directProducts, 'productList');
}

async function renderLineProducts() {
  const qs = state.selectedLocationId ? `&location_id=${state.selectedLocationId}` : '';
  const line = (await api('/lines')).find(l => l.id === state.selectedLineId);
  const products = await api(`/products?line_id=${state.selectedLineId}${qs}`);
  state.products = [...state.products, ...products];

  app.innerHTML = `
    <button class="btn-outline" id="backBtn" style="width:auto;padding:8px 14px;font-size:13px;margin-bottom:12px;">← Назад</button>
    <h1 class="page-title">${line ? line.name : 'Линейка'}</h1>
    <div id="productList"></div>
  `;
  document.getElementById('backBtn').onclick = () => { state.selectedLineId = null; renderCatalog(); };
  renderProductList(products, 'productList');
}

function renderProductList(products, containerId) {
  const list = document.getElementById(containerId);
  if (products.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">📦</div>Товаров пока нет</div>`;
    return;
  }

  products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';
    const inCart = state.cart[p.id] || 0;
    card.innerHTML = `
      <div class="product-thumb"></div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.description || ''}</div>
        <div class="product-price">${money(p.price)}
          <span class="stock-tag ${p.quantity > 0 ? '' : 'out'}">${p.quantity > 0 ? `в наличии: ${p.quantity}` : 'нет в наличии'}</span>
        </div>
        <div class="qty-row">
          <button class="qty-btn" data-act="minus">−</button>
          <span id="qty-${p.id}">${inCart}</span>
          <button class="qty-btn" data-act="plus">+</button>
          <button class="btn-outline" style="width:auto;padding:6px 12px;font-size:12px;" data-act="where">Где взять?</button>
        </div>
      </div>
    `;
    const [minusBtn, plusBtn] = card.querySelectorAll('[data-act="minus"], [data-act="plus"]');
    minusBtn.onclick = () => changeQty(p, -1);
    plusBtn.onclick = () => changeQty(p, +1);
    card.querySelector('[data-act="where"]').onclick = () => showAvailability(p);
    list.appendChild(card);
  });
}

function changeQty(product, delta) {
  const current = state.cart[product.id] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete state.cart[product.id];
  else state.cart[product.id] = next;
  const span = document.getElementById(`qty-${product.id}`);
  if (span) span.textContent = state.cart[product.id] || 0;
}

async function showAvailability(product) {
  const rows = await api(`/products/${product.id}/availability`);
  const text = rows.length
    ? rows.map(r => `${r.name} — ${r.quantity} шт${r.is_open ? '' : ' (закрыто)'}`).join('\n')
    : 'Пока нигде нет в наличии';
  tg?.showAlert ? tg.showAlert(`${product.name}:\n${text}`) : alert(`${product.name}:\n${text}`);
}

async function renderCart() {
  const ids = Object.keys(state.cart);
  if (ids.length === 0) {
    app.innerHTML = `
      <h1 class="page-title">Корзина</h1>
      <div class="empty-state">
        <div class="emoji">🛒</div>
        <div>Корзина пуста</div>
        <div style="margin-top:16px;">
          <button class="btn-primary" id="toCatalog">Открыть каталог →</button>
        </div>
      </div>
    `;
    document.getElementById('toCatalog').onclick = () => switchTab('catalog');
    return;
  }

  if (state.products.length === 0) state.products = await api('/products');

  let total = 0;
  const rowsHtml = ids.map(id => {
    const p = state.products.find(pr => String(pr.id) === id);
    if (!p) return '';
    const qty = state.cart[id];
    total += p.price * qty;
    return `
      <div class="cart-item">
        <div>${p.name} × ${qty}</div>
        <div>${money(p.price * qty)}</div>
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <h1 class="page-title">Корзина</h1>
    <div class="card">${rowsHtml}</div>
    <div class="card">
      <div class="cart-item"><b>Итого</b><b>${money(total)}</b></div>
    </div>
    <button class="btn-primary" id="checkoutBtn">Оформить заказ</button>
  `;
  document.getElementById('checkoutBtn').onclick = checkout;
}

async function checkout() {
  const items = Object.entries(state.cart).map(([product_id, qty]) => ({ product_id: Number(product_id), qty }));
  try {
    const result = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        telegram_user_id: tgUser?.id ? String(tgUser.id) : null,
        telegram_username: tgUser?.username || null,
        location_id: state.selectedLocationId,
        items,
      }),
    });
    state.cart = {};
    tg?.showAlert ? tg.showAlert(`Заказ #${result.order_id} оформлен! Итого: ${money(result.total)}`) : alert('Заказ оформлен!');
    switchTab('orders');
  } catch (e) {
    tg?.showAlert ? tg.showAlert('Не удалось оформить заказ. Попробуйте ещё раз.') : alert('Ошибка оформления заказа');
  }
}

async function renderOrders() {
  if (!tgUser?.id) {
    app.innerHTML = `<h1 class="page-title">Мои заказы</h1><div class="empty-state">Откройте приложение через Telegram, чтобы видеть свои заказы.</div>`;
    return;
  }
  const orders = await api(`/orders?telegram_user_id=${tgUser.id}`);
  app.innerHTML = `<h1 class="page-title">Мои заказы</h1><div id="orderList"></div>`;
  const list = document.getElementById('orderList');

  if (orders.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">📋</div>Пока нет заказов</div>`;
    return;
  }

  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="order-status">● ${o.status === 'new' ? 'Новый' : o.status}</div>
      <div style="font-weight:800;font-size:18px;margin:8px 0 4px;">Заказ #${o.id}</div>
      <div style="color:#9c93b5;font-size:13px;">${o.items.length} позиц. · ${o.items.reduce((a,i)=>a+i.qty,0)} шт</div>
      <div style="margin-top:8px;font-weight:700;">${money(o.total)}</div>
    `;
    list.appendChild(div);
  });
}

function renderProfile() {
  app.innerHTML = `
    <h1 class="page-title">Профиль</h1>
    <div class="card">
      <div style="font-weight:700;">${tgUser ? (tgUser.first_name || '') + (tgUser.username ? ' · @' + tgUser.username : '') : 'Гость'}</div>
    </div>
    <div class="card" style="background:linear-gradient(90deg,#7b4bf0,#9a5bff);">
      <div style="opacity:.85;">Ваш баланс</div>
      <div style="font-size:32px;font-weight:800;">0 ☁️</div>
    </div>
  `;
}

const renderers = { shops: renderShops, catalog: renderCatalog, cart: renderCart, orders: renderOrders, profile: renderProfile };

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderers[tab]();
}

document.querySelectorAll('.navbtn').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });

switchTab('shops');
