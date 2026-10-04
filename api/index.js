// Backend Node simple. Stockage JSON via jsonblob.com (sans clé ni compte).
const C = require('./config');
const B = 'https://jsonblob.com/api/jsonBlob';
const H = { 'Content-Type': 'application/json', Accept: 'application/json' };
const get = async id => { const r = await fetch(`${B}/${id}`, { headers: H }); if (!r.ok) throw Error('Lecture impossible'); return r.json(); };
const put = async (id, d) => { const r = await fetch(`${B}/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(d) }); if (!r.ok) throw Error('Écriture impossible'); };
const mk = async d => { const r = await fetch(B, { method: 'POST', headers: H, body: JSON.stringify(d) }); return r.headers.get('location').split('/').pop(); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const T = ['games', 'cats', 'items', 'pays', 'posts'];
const price = i => Math.round(i.price * (100 - (i.discount || 0)) / 100);

module.exports = async (req, res) => {
  try {
    const b = req.method === 'POST' ? (req.body || {}) : {};
    const a = b.a || req.query.a;
    if (a === 'setup') {
      if (C.CATALOG_ID) return res.status(200).send('Déjà configuré.');
      const c = await mk({ games: [], cats: [], items: [], pays: [], posts: [] });
      const d = await mk({ orders: [], chats: [] });
      return res.status(200).send(`Copiez dans api/config.js puis redéployez :\n\nCATALOG_ID: '${c}',\nDATA_ID: '${d}'`);
    }
    if (!C.CATALOG_ID) throw Error('Ouvrez /api?a=setup une fois');
    const admin = req.headers['x-pass'] === C.ADMIN_PASSWORD;
    const sid = String(b.sid || '').replace(/\W/g, '').slice(0, 40);

    // ---- public ----
    if (a === 'catalog') return res.json(await get(C.CATALOG_ID));
    if (a === 'order') {
      const cat = await get(C.CATALOG_ID), lines = []; let total = 0;
      for (const [id, n] of Object.entries(b.cart || {})) {
        const i = cat.items.find(x => x.id === id);
        if (!i || i.soldout) continue;
        const q = Math.max(1, Math.min(50, +n || 1)); lines.push(`${i.name} ×${q}`); total += price(i) * q;
      }
      const p = cat.pays.find(x => x.id === b.pay);
      if (!lines.length || !p) throw Error('Commande invalide');
      let shot = '';
      if (b.shot && b.shot.length < 1500000) shot = await mk({ img: b.shot });
      const d = await get(C.DATA_ID);
      d.orders.push({ id: uid(), sid, items: lines.join(', '), total, gid: String(b.gid).slice(0, 80), pseudo: String(b.pseudo).slice(0, 80), pay: p.name, phone: String(b.phone).slice(0, 30), email: String(b.email).slice(0, 120), msg: String(b.msg || '').slice(0, 1000), shot, status: 'pending', created: new Date().toISOString() });
      await put(C.DATA_ID, d); return res.json({ ok: 1 });
    }
    if (a === 'myorders') { const d = await get(C.DATA_ID); return res.json(d.orders.filter(o => o.sid === sid).reverse().map(({ shot, ...o }) => o)); }
    if (a === 'chat') { const d = await get(C.DATA_ID); return res.json(d.chats.filter(m => m.sid === sid)); }
    if (a === 'say') {
      const msg = String(b.msg || '').trim().slice(0, 500); if (!msg || !sid) throw Error('Message vide');
      const d = await get(C.DATA_ID); d.chats.push({ id: uid(), sid, admin: 0, msg, at: Date.now() }); await put(C.DATA_ID, d); return res.json({ ok: 1 });
    }

    // ---- admin ----
    if (a === 'login') return res.json({ ok: admin });
    if (!admin) return res.status(401).json({ error: 'Mot de passe incorrect' });
    if (a === 'save' || a === 'del') {
      if (!T.includes(b.t)) throw Error('Table inconnue');
      const c = await get(C.CATALOG_ID);
      if (a === 'del') c[b.t] = c[b.t].filter(x => x.id !== b.id);
      else if (b.row.id) c[b.t] = c[b.t].map(x => x.id === b.row.id ? b.row : x);
      else c[b.t].push({ ...b.row, id: uid() });
      await put(C.CATALOG_ID, c); return res.json({ ok: 1 });
    }
    if (a === 'orders' || a === 'chats') { const d = await get(C.DATA_ID); return res.json(d[a].slice().reverse()); }
    if (a === 'status' || a === 'delorder' || a === 'reply') {
      const d = await get(C.DATA_ID);
      if (a === 'status') d.orders.forEach(o => { if (o.id === b.id) o.status = b.status; });
      if (a === 'delorder') d.orders = d.orders.filter(o => o.id !== b.id);
      if (a === 'reply') d.chats.push({ id: uid(), sid, admin: 1, msg: String(b.msg).slice(0, 500), at: Date.now() });
      await put(C.DATA_ID, d); return res.json({ ok: 1 });
    }
    if (a === 'shot') return res.json(await get(String(b.id).replace(/[^\w-]/g, '')));
    res.status(400).json({ error: 'Action inconnue' });
  } catch (x) { res.status(500).json({ error: x.message }); }
};
