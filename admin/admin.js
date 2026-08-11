let adminPassword = sessionStorage.getItem('adminPassword') || '';

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    ...opts,
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

document.getElementById('loginBtn').onclick = async () => {
  const pass = document.getElementById('passwordInput').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass }),
  });
  if (res.ok) {
    adminPassword = pass;
    sessionStorage.setItem('adminPassword', pass);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminScreen').style.display = 'flex';
    switchTab('orders');
  } else {
    document.getElementById('loginError').textContent = 'Неверный пароль';
  }
};

if (adminPassword) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminScreen').style.display = 'flex';
  switchTab('orders');
}

document.querySelectorAll('.tabbtn').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabbtn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    switchTab(b.dataset.tab);
  };
});

function switchTab(tab) {
  const map = { orders: renderOrders, products: renderProducts, locations: renderLocations, stock: renderStock };
  map[tab]();
}

async function renderOrders() {
  const content = document.getElementById('content');
  content.innerHTML = '<h2>Заказы</h2><div id="ordersTable">Загрузка...</div>';
  const orders = await api('/admin/orders');
  const table = document.getElementById('ordersTable');
  if (orders.length === 0) { table.innerHTML = 'Пока нет заказов'; return; }

  table.innerHTML = `
    <table>
      <tr><th>#</th><th>Клиент</th><th>Точка</th><th>Состав</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr>
      ${orders.map(o => `
        <tr>
          <td>${o.id}</td>
          <td>${o.telegram_username ? '@' + o.telegram_username : (o.telegram_user_id || '—')}</td>
          <td>${o.location_id || '—'}</td>
          <td>${o.items.map(i => `${i.name} ×${i.qty}`).join(', ')}</td>
          <td>${o.total} ₽</td>
          <td>
            <select data-id="${o.id}" class="statusSelect">
              ${['new','confirmed','ready','done','cancelled'].map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('')}
            </select>
          </td>
          <td>${o.created_at}</td>
        </tr>
      `).join('')}
    </table>
  `;

  table.querySelectorAll('.statusSelect').forEach(sel => {
    sel.onchange = async () => {
      await api(`/admin/orders/${sel.dataset.id}/status`, { method: 'PUT', body: JSON.stringify({ status: sel.value }) });
    };
  });
}

async function renderProducts() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>Товары</h2>
    <div class="form-row">
      <input id="p_name" placeholder="Название">
      <input id="p_desc" placeholder="Описание">
      <input id="p_price" placeholder="Цена" type="number">
      <input id="p_category" placeholder="Категория">
      <label><input type="checkbox" id="p_new"> Новинка</label>
      <label><input type="checkbox" id="p_promo"> Акция</label>
      <button class="small" id="addProductBtn">Добавить</button>
    </div>
    <div id="productsTable">Загрузка...</div>
  `;

  document.getElementById('addProductBtn').onclick = async () => {
    await api('/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('p_name').value,
        description: document.getElementById('p_desc').value,
        price: parseFloat(document.getElementById('p_price').value) || 0,
        category: document.getElementById('p_category').value || 'Прочее',
        is_new: document.getElementById('p_new').checked,
        is_promo: document.getElementById('p_promo').checked,
      }),
    });
    renderProducts();
  };

  const products = await api('/admin/products');
  const table = document.getElementById('productsTable');
  table.innerHTML = `
    <table>
      <tr><th>Название</th><th>Категория</th><th>Цена</th><th>Метки</th><th></th></tr>
      ${products.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.category}</td>
          <td>${p.price} ₽</td>
          <td>${p.is_new ? '<span class="badge">Новинка</span>' : ''} ${p.is_promo ? '<span class="badge">Акция</span>' : ''}</td>
          <td><button class="small danger" data-id="${p.id}">Удалить</button></td>
        </tr>
      `).join('')}
    </table>
  `;
  table.querySelectorAll('button.danger').forEach(btn => {
    btn.onclick = async () => { await api(`/admin/products/${btn.dataset.id}`, { method: 'DELETE' }); renderProducts(); };
  });
}

async function renderLocations() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>Точки продажи</h2>
    <div class="form-row">
      <input id="l_name" placeholder="Название точки">
      <input id="l_address" placeholder="Адрес">
      <label><input type="checkbox" id="l_open" checked> Открыт</label>
      <button class="small" id="addLocBtn">Добавить</button>
    </div>
    <div id="locTable">Загрузка...</div>
  `;

  document.getElementById('addLocBtn').onclick = async () => {
    await api('/admin/locations', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('l_name').value,
        address: document.getElementById('l_address').value,
        is_open: document.getElementById('l_open').checked,
      }),
    });
    renderLocations();
  };

  const locations = await api('/admin/locations');
  const table = document.getElementById('locTable');
  table.innerHTML = `
    <table>
      <tr><th>Название</th><th>Адрес</th><th>Статус</th><th></th></tr>
      ${locations.map(l => `
        <tr>
          <td>${l.name}</td>
          <td>${l.address || ''}</td>
          <td>${l.is_open ? 'Открыт' : 'Закрыт'}</td>
          <td>
