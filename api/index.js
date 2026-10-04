// Backend Node simple. Stockage JSON via jsonblob.com (sans clé ni compte).
const C = require('./config');
const U = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const K = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const cmd = async a => {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + K }, body: JSON.stringify(a) });
  const j = await r.json(); if (j.error) throw Error(j.error); return j.result;
};
const EMPTY = { catalog: { games: [], cats: [], items: [], pays: [], posts: [] }, data: { orders: [], chats: [] } };
const get = async k => { const v = await cmd(['GET', 'cm:' + k]); return v ? JSON.parse(v) : (EMPTY[k] || {}); };
const put = (k, d) => cmd(['SET', 'cm:' + k, JSON.stringify(d)]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const T = ['games', 'cats', 'items', 'pays', 'posts'];
const price = i => Math.round(i.price * (100 - (i.discount || 0)) / 100);

module.exports = async (req, res) => {
  try {
    const b = req.method === 'POST' ? (req.body || {}) : {};
    const a = b.a || req.query.a;
    if (!U || !K) throw Error('Stockage non connecté : Vercel > Storage > Upstash Redis > Connect to project, puis Redeploy');
    const admin = req.headers['x-pass'] === C.ADMIN_PASSWORD;
    const sid = String(b.sid || '').replace(/\W/g, '').slice(0, 40);

    // ---- public ----
    if (a === 'catalog') return res.json(await get('catalog'));
    if (a === 'order') {
      const cat = await get('catalog'), lines = []; let total = 0;
      for (const [id, n] of Object.entries(b.cart || {})) {
        const i = cat.items.find(x => x.id === id);
        if (!i || i.soldout) continue;
        const q = Math.max(1, Math.min(50, +n || 1)); lines.push(`${i.name} ×${q}`); total += price(i) * q;
      }
      const p = cat.pays.find(x => x.id === b.pay);
      if (!lines.length || !p) throw Error('Commande invalide');
      let shot = '';
      if (b.shot && b.shot.length < 900000) { shot = uid(); await put('shot:' + shot, { img: b.shot }); }
      const d = await get('data');
      d.orders.push({ id: uid(), sid, items: lines.join(', '), total, gid: String(b.gid).slice(0, 80), pseudo: String(b.pseudo).slice(0, 80), pay: p.name, phone: String(b.phone).slice(0, 30), email: String(b.email).slice(0, 120), msg: String(b.msg || '').slice(0, 1000), shot, status: 'pending', created: new Date().toISOString() });
      await put('data', d); return res.json({ ok: 1 });
    }
    if (a === 'myorders') { const d = await get('data'); return res.json(d.orders.filter(o => o.sid === sid).reverse().map(({ shot, ...o }) => o)); }
    if (a === 'chat') { const d = await get('data'); return res.json(d.chats.filter(m => m.sid === sid)); }
    if (a === 'say') {
      const msg = String(b.msg || '').trim().slice(0, 500); if (!msg || !sid) throw Error('Message vide');
      const d = await get('data'); d.chats.push({ id: uid(), sid, admin: 0, msg, at: Date.now() }); await put('data', d); return res.json({ ok: 1 });
    }

    // ---- admin ----
    if (a === 'login') return res.json({ ok: admin });
    if (!admin) return res.status(401).json({ error: 'Mot de passe incorrect' });
    if (a === 'save' || a === 'del') {
      if (!T.includes(b.t)) throw Error('Table inconnue');
      const c = await get('catalog');
      if (a === 'del') c[b.t] = c[b.t].filter(x => x.id !== b.id);
      else if (b.row.id) c[b.t] = c[b.t].map(x => x.id === b.row.id ? b.row : x);
      else c[b.t].push({ ...b.row, id: uid() });
      await put('catalog', c); return res.json({ ok: 1 });
    }
    if (a === 'orders' || a === 'chats') { const d = await get('data'); return res.json(d[a].slice().reverse()); }
    if (a === 'status' || a === 'delorder' || a === 'reply') {
      const d = await get('data');
      if (a === 'status') d.orders.forEach(o => { if (o.id === b.id) o.status = b.status; });
      if (a === 'delorder') d.orders = d.orders.filter(o => o.id !== b.id);
      if (a === 'reply') d.chats.push({ id: uid(), sid, admin: 1, msg: String(b.msg).slice(0, 500), at: Date.now() });
      await put('data', d); return res.json({ ok: 1 });
    }
    if (a === 'shot') return res.json(await get('shot:' + String(b.id).replace(/\W/g, '')));
    res.status(400).json({ error: 'Action inconnue' });
  } catch (x) { res.status(500).json({ error: x.message }); }
};
