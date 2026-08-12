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
  try {
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
      document.getElementById('loginError').textContent = 'Неверный пароль (код ' + res.status + ')';
    }
  } catch (err) {
    alert('ОШИБКА ВХОДА: ' + err.message);
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
  const map = { orders: renderOrders, products: renderProducts, lines: renderLines, locations: renderLocations, stock: renderStock, banners: renderBanners };
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
  const lines = await api('/admin/lines');

  content.innerHTML = `
    <h2>Товары</h2>
    <div class="form-row">
      <input id="p_name" placeholder="Название">
      <input id="p_desc" placeholder="Описание">
      <input id="p_price" placeholder="Цена" type="number">
      <input id="p_category" placeholder="Категория">
      <select id="p_line">
        <option value="">Без линейки</option>
        ${lines.map(l => `<option value="${l.id}">${l.name} (${l.category})</option>`).join('')}
      </select>
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
        line_id: document.getElementById('p_line').value || null,
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
      <tr><th>Название</th><th>Категория</th><th>Линейка</th><th>Цена</th><th>Метки</th><th></th></tr>
      ${products.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.category}</td>
          <td>${p.line_name || '—'}</td>
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

async function renderLines() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>Линейки</h2>
    <p style="color:#9c93b5;font-size:13px;margin-top:-8px;">Например: категория «Жидкости», линейка «Рик и Морти» — внутри неё уже добавляйте вкусы как обычные товары, выбрав эту линейку.</p>
    <div class="form-row">
      <input id="ln_category" placeholder="Категория (Жидкости)">
      <input id="ln_name" placeholder="Название линейки (Рик и Морти)">
      <button class="small" id="addLineBtn">Добавить</button>
    </div>
    <div id="linesTable">Загрузка...</div>
  `;
  document.getElementById('addLineBtn').onclick = async () => {
    await api('/admin/lines', {
      method: 'POST',
      body: JSON.stringify({
        category: document.getElementById('ln_category').value || 'Прочее',
        name: document.getElementById('ln_name').value,
      }),
    });
    renderLines();
  };

  const lines = await api('/admin/lines');
  const table = document.getElementById('linesTable');
  table.innerHTML = `
    <table>
      <tr><th>Категория</th><th>Линейка</th><th></th></tr>
      ${lines.map(l => `
        <tr>
          <td>${l.category}</td>
          <td>${l.name}</td>
          <td><button class="small danger" data-id="${l.id}">Удалить</button></td>
        </tr>
      `).join('')}
    </table>
  `;
  table.querySelectorAll('button.danger').forEach(btn => {
    btn.onclick = async () => { await api(`/admin/lines/${btn.dataset.id}`, { method: 'DELETE' }); renderLines(); };
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
          <td><button class="small danger" data-id="${l.id}">Удалить</button></td>
        </tr>
      `).join('')}
    </table>
  `;
  table.querySelectorAll('button.danger').forEach(btn => {
    btn.onclick = async () => { await api(`/admin/locations/${btn.dataset.id}`, { method: 'DELETE' }); renderLocations(); };
  });
}

async function renderStock() {
  const content = document.getElementById('content');
  content.innerHTML = `<h2>Остатки по точкам</h2><p style="color:#9c93b5;font-size:13px;margin-top:-8px;">Товар не удаляется при продаже — просто поставьте 0, а при поступлении верните нужное число.</p><div id="stockForm"></div><div id="stockTable">Загрузка...</div>`;

  const [products, locations, stock] = await Promise.all([
    api('/admin/products'), api('/admin/locations'), api('/admin/stock'),
  ]);

  const form = document.getElementById('stockForm');
  form.innerHTML = `
    <div class="form-row">
      <select id="s_product">${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
      <select id="s_location">${locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select>
      <input id="s_qty" type="number" placeholder="Количество">
      <button class="small" id="setStockBtn">Сохранить остаток</button>
    </div>
  `;
  document.getElementById('setStockBtn').onclick = async () => {
    await api('/admin/stock', {
      method: 'PUT',
      body: JSON.stringify({
        product_id: document.getElementById('s_product').value,
        location_id: document.getElementById('s_location').value,
        quantity: parseInt(document.getElementById('s_qty').value, 10) || 0,
      }),
    });
    renderStock();
  };

  const table = document.getElementById('stockTable');
  table.innerHTML = `
    <table>
      <tr><th>Товар</th><th>Точка</th><th>Количество</th><th></th></tr>
      ${stock.map(s => `
        <tr>
          <td>${s.product_name}</td>
          <td>${s.location_name}</td>
          <td>${s.quantity}</td>
          <td><button class="small ${s.quantity > 0 ? 'danger' : ''}" data-pid="${s.product_id}" data-lid="${s.location_id}" data-cur="${s.quantity}">${s.quantity > 0 ? 'Нет в наличии' : 'Восстановить (10)'}</button></td>
        </tr>
      `).join('')}
    </table>
  `;
  table.querySelectorAll('button[data-pid]').forEach(btn => {
    btn.onclick = async () => {
      const cur = Number(btn.dataset.cur);
      const newQty = cur > 0 ? 0 : 10;
      await api('/admin/stock', {
        method: 'PUT',
        body: JSON.stringify({ product_id: btn.dataset.pid, location_id: btn.dataset.lid, quantity: newQty }),
      });
      renderStock();
    };
  });
}

async function renderBanners() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>Баннеры «Товар дня»</h2>
    <p style="color:#9c93b5;font-size:13px;margin-top:-8px;">Клиенты листают их горизонтально на главной. Добавьте несколько — один под товар дня, другой под акцию.</p>
    <div class="form-row">
      <input id="b_badge" placeholder="Метка (⭐ ТОВАР ДНЯ)">
      <input id="b_title" placeholder="Заголовок">
      <input id="b_subtitle" placeholder="Подзаголовок / цена">
      <input id="b_order" placeholder="Порядок (0,1,2...)" type="number">
      <button class="small" id="addBannerBtn">Добавить</button>
    </div>
    <div id="bannersTable">Загрузка...</div>
  `;
  document.getElementById('addBannerBtn').onclick = async () => {
    await api('/admin/banners', {
      method: 'POST',
      body: JSON.stringify({
        badge: document.getElementById('b_badge').value,
        title: document.getElementById('b_title').value,
        subtitle: document.getElementById('b_subtitle').value,
        sort_order: parseInt(document.getElementById('b_order').value, 10) || 0,
      }),
    });
    renderBanners();
  };

  const banners = await api('/admin/banners');
  const table = document.getElementById('bannersTable');
  table.innerHTML = `
    <table>
      <tr><th>Метка</th><th>Заголовок</th><th>Подзаголовок</th><th>Порядок</th><th></th></tr>
      ${banners.map(b => `
        <tr>
          <td>${b.badge || ''}</td>
          <td>${b.title}</td>
          <td>${b.subtitle || ''}</td>
          <td>${b.sort_order}</td>
          <td><button class="small danger" data-id="${b.id}">Удалить</button></td>
        </tr>
      `).join('')}
    </table>
  `;
  table.querySelectorAll('button.danger').forEach(btn => {
    btn.onclick = async () => { await api(`/admin/banners/${btn.dataset.id}`, { method: 'DELETE' }); renderBanners(); };
  });
}
