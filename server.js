require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

const { MONGODB_URI, JWT_SECRET, SIGNUP_CODE = '', DB_NAME = 'diary', NODE_ENV } = process.env;
const PORT = process.env.PORT || 3000;
const QUOTA = Number(process.env.PHOTO_QUOTA_MB || 40) * 1024 * 1024;
if (!MONGODB_URI || !JWT_SECRET || JWT_SECRET.length < 24) {
  console.error('Set MONGODB_URI and a JWT_SECRET of at least 24 characters (see .env.example).');
  process.exit(1);
}

const COOKIE = 'diary_session';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isId = (s) => /^[a-f0-9]{24}$/.test(s);

let users, entries, files, bucket, client;

const app = express();
if (NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"],
    },
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: '300kb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a few minutes and try again.' } });

function issue(res, id) {
  const token = jwt.sign({ uid: String(id) }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', maxAge: 30 * 864e5 });
}
async function auth(req, res, next) {
  try {
    const token = req.cookies[COOKIE];
    if (!token) return bad(res, 'Please log in.', 401);
    const p = jwt.verify(token, JWT_SECRET);
    if (!ObjectId.isValid(p.uid)) return bad(res, 'Please log in.', 401);
    const u = await users.findOne({ _id: new ObjectId(p.uid) }, { projection: { email: 1 } });
    if (!u) return bad(res, 'Please log in.', 401);
    req.uid = p.uid; req.user = u; next();
  } catch (e) { bad(res, 'Please log in.', 401); }
}

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/config', (req, res) => res.json({ invite: !!SIGNUP_CODE }));

app.post('/api/signup', limiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return bad(res, 'Enter a valid email address.');
  if (pw.length < 8 || pw.length > 200) return bad(res, 'Use a password of at least 8 characters.');
  if (SIGNUP_CODE && !same(String(req.body.code || ''), SIGNUP_CODE)) return bad(res, 'That invite code is not right.');
  try {
    const r = await users.insertOne({ email, hash: await bcrypt.hash(pw, 12), created: new Date() });
    issue(res, r.insertedId); res.json({ user: { email } });
  } catch (e) {
    if (e.code === 11000) return bad(res, 'An account with that email already exists.');
    throw e;
  }
});
app.post('/api/login', limiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  const u = await users.findOne({ email });
  const ok = await bcrypt.compare(pw.slice(0, 200), u ? u.hash : DUMMY_HASH);
  if (!u || !ok) return bad(res, 'Wrong email or password.', 401);
  issue(res, u._id); res.json({ user: { email } });
});
app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: { email: req.user.email } }));

async function dropPhotos(uid, ids) {
  for (const id of ids) {
    if (!isId(id)) continue;
    const f = await files.findOne({ _id: new ObjectId(id), 'metadata.uid': uid });
    if (f) await bucket.delete(f._id).catch(() => {});
  }
}
app.delete('/api/me', auth, async (req, res) => {
  const u = await users.findOne({ _id: req.user._id });
  if (!u) return bad(res, 'Account not found.', 404);
  if (!(await bcrypt.compare(String(req.body.password || '').slice(0, 200), u.hash))) return bad(res, 'That password is not right.', 401);
  const ids = await files.find({ 'metadata.uid': req.uid }, { projection: { _id: 1 } }).toArray();
  await dropPhotos(req.uid, ids.map((f) => String(f._id)));
  await entries.deleteMany({ uid: req.uid });
  await users.deleteOne({ _id: req.user._id });
  res.clearCookie(COOKIE); res.json({ ok: true });
});

/* entries: only known fields are kept, everything is scoped to the logged-in user */
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
function shape(b) {
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((i) => {
    const t = i && ['text', 'note', 'photo', 'sticker'].includes(i.t) ? i.t : null;
    if (!t) return null;
    const o = { i: str(i.i, 40), t, x: num(i.x, -0.5, 1.5, 0), y: num(i.y, 0, 20000, 0), w: num(i.w, 0.05, 1.5, 0.4), r: num(i.r, -180, 180, 0) };
    if (t === 'text' || t === 'note') o.h = str(i.h, 20000);
    if (t === 'note') o.k = ['y', 'p', 'b', 'g', 'torn'].includes(i.k) ? i.k : 'y';
    if (t === 'photo') {
      o.pid = str(i.pid, 40); o.src = str(i.src, 100); o.cap = str(i.cap, 500);
      if (!/^\/api\/photos\/[a-f0-9]{24}$/.test(o.src)) return null;
    }
    if (t === 'sticker') o.e = str(i.e, 16);
    return o;
  }).filter(Boolean);
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null, title: str(b.title, 200), mood: str(b.mood, 8), items, updated: Date.now() };
}
const photoIds = (e) => (e && e.items ? e.items.filter((i) => i.t === 'photo').map((i) => i.pid) : []);

app.get('/api/entries', auth, async (req, res) => {
  const list = await entries.find({ uid: req.uid }, { projection: { _id: 0, uid: 0 } }).sort({ date: -1 }).limit(5000).toArray();
  res.json({ entries: list });
});
app.put('/api/entries/:id', auth, async (req, res) => {
  if (!/^[\w-]{1,64}$/.test(req.params.id)) return bad(res, 'Bad entry id.');
  const s = shape(req.body || {});
  if (!s.date) return bad(res, 'Entry needs a date.');
  const old = await entries.findOneAndUpdate({ uid: req.uid, id: req.params.id }, { $set: s }, { upsert: true, returnDocument: 'before' });
  const keep = new Set(photoIds(s));
  await dropPhotos(req.uid, photoIds(old).filter((p) => !keep.has(p)));
  res.json({ ok: true });
});
app.delete('/api/entries/:id', auth, async (req, res) => {
  const old = await entries.findOneAndDelete({ uid: req.uid, id: req.params.id });
  await dropPhotos(req.uid, photoIds(old));
  res.json({ ok: true });
});
app.get('/api/export', auth, async (req, res) => {
  const list = await entries.find({ uid: req.uid }, { projection: { _id: 0, uid: 0 } }).sort({ date: 1 }).toArray();
  res.set('Content-Disposition', 'attachment; filename="diary-backup.json"');
  res.json({ exported: new Date().toISOString(), email: req.user.email, entries: list });
});

/* photos: stored in MongoDB GridFS, readable only by their owner */
app.post('/api/photos', auth, uploadLimiter, express.raw({ type: 'image/jpeg', limit: '4mb' }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return bad(res, 'Please upload a JPEG photo.');
  const used = await files.aggregate([{ $match: { 'metadata.uid': req.uid } }, { $group: { _id: null, n: { $sum: '$length' } } }]).toArray();
  if (((used[0] && used[0].n) || 0) + buf.length > QUOTA) return bad(res, 'Your photo space is full. Remove some photos first.', 413);
  const id = new ObjectId();
  await new Promise((ok, no) => {
    const s = bucket.openUploadStreamWithId(id, 'photo.jpg', { metadata: { uid: req.uid }, contentType: 'image/jpeg' });
    s.on('error', no).on('finish', ok); s.end(buf);
  });
  res.json({ id: String(id), url: '/api/photos/' + id });
});
app.get('/api/photos/:id', auth, async (req, res) => {
  if (!isId(req.params.id)) return res.sendStatus(404);
  const f = await files.findOne({ _id: new ObjectId(req.params.id), 'metadata.uid': req.uid });
  if (!f) return res.sendStatus(404);
  res.set({ 'Content-Type': 'image/jpeg', 'Content-Length': f.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  bucket.openDownloadStream(f._id).on('error', () => res.end()).pipe(res);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'That is too large to save.', 413);
  if (err.status && err.status < 500) return bad(res, 'Bad request.', err.status);
  console.error(err); bad(res, 'Something went wrong on the server.', 500);
});

(async () => {
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  users = db.collection('users'); entries = db.collection('entries'); files = db.collection('photos.files');
  bucket = new GridFSBucket(db, { bucketName: 'photos' });
  await users.createIndex({ email: 1 }, { unique: true });
  await entries.createIndex({ uid: 1, id: 1 }, { unique: true });
  await files.createIndex({ 'metadata.uid': 1 });
  const server = app.listen(PORT, () => console.log('Diary running on port ' + PORT));

  async function shutdown() {
    console.log('Shutting down…');
    server.close();
    await client.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((e) => { console.error('Could not start:', e.message); process.exit(1); });
