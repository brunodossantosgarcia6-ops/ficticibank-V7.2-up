const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || path.join(__dirname, "fictibank.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  pix_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  from_user_id TEXT,
  to_user_id TEXT,
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(from_user_id) REFERENCES users(id),
  FOREIGN KEY(to_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

function now() { return new Date().toISOString(); }
function id(prefix="FB") {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}
function normalizeUsername(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}
function normalizePixKey(v) {
  return String(v || "").trim().toLowerCase();
}
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    balance: Number(row.balance),
    pixKey: row.pix_key
  };
}

function seedUser(username, displayName, password, balance) {
  const exists = db.prepare("SELECT id FROM users WHERE username=?").get(username);
  if (exists) return;
  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, balance, pix_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), username, displayName, bcrypt.hashSync(password, 10),
    balance, `${username}@fictibank`, now()
  );
}

// Demo accounts for the fictional simulation.
seedUser("bruno", "Bruno", "Bruno*1902", 1250);
seedUser("irmao", "Irmão", "4321", 650);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/ping", (_, res) => res.json({ ok: true, version: "7.2.0" }));

app.post("/api/register", (req, res) => {
  const username = normalizeUsername(req.body.username);
  const displayName = String(req.body.displayName || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-z0-9._-]{3,24}$/.test(username))
    return res.status(400).json({ error: "Usuário inválido. Use 3–24 caracteres: letras, números, ponto, _ ou -." });
  if (displayName.length < 2 || displayName.length > 40)
    return res.status(400).json({ error: "Nome inválido." });
  if (password.length < 6)
    return res.status(400).json({ error: "A senha precisa ter pelo menos 6 caracteres." });

  const exists = db.prepare("SELECT id FROM users WHERE username=?").get(username);
  if (exists) return res.status(409).json({ error: "Esse usuário já existe." });

  let pixKey = `${username}@fictibank`;
  if (db.prepare("SELECT id FROM users WHERE pix_key=?").get(pixKey)) {
    pixKey = `${username}${crypto.randomBytes(2).toString("hex")}@fictibank`;
  }

  const userId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, balance, pix_key, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(userId, username, displayName, bcrypt.hashSync(password, 10), pixKey, now());

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Usuário ou senha incorretos." });
  res.json({ user: publicUser(user) });
});

app.get("/api/account/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const tx = db.prepare(`
    SELECT t.*, fu.username AS from_username, tu.username AS to_username,
           fu.display_name AS from_name, tu.display_name AS to_name
    FROM transactions t
    LEFT JOIN users fu ON fu.id=t.from_user_id
    LEFT JOIN users tu ON tu.id=t.to_user_id
    WHERE t.from_user_id=? OR t.to_user_id=?
    ORDER BY t.created_at DESC LIMIT 100
  `).all(user.id, user.id);

  const notifications = db.prepare(`
    SELECT id,title,body,read,created_at FROM notifications
    WHERE user_id=? ORDER BY id DESC LIMIT 30
  `).all(user.id);

  res.json({
    user: publicUser(user),
    transactions: tx,
    notifications
  });
});

app.post("/api/add-money", (req, res) => {
  const userId = String(req.body.userId || "");
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000)
    return res.status(400).json({ error: "Valor inválido." });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  const txId = id();
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount, userId);
    db.prepare(`
      INSERT INTO transactions(id,from_user_id,to_user_id,amount,description,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(txId, null, userId, amount, "Adição de saldo fictício", now());
    db.prepare(`
      INSERT INTO notifications(user_id,title,body,created_at)
      VALUES(?,?,?,?)
    `).run(userId, "Saldo adicionado", `R$ ${amount.toFixed(2)} adicionados à sua conta.`, now());
  });
  tx();
  const updated = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
  res.json({ user: publicUser(updated), transactionId: txId });
});

app.post("/api/pix", (req, res) => {
  const fromId = String(req.body.fromUserId || "");
  const key = normalizePixKey(req.body.pixKey);
  const amount = Number(req.body.amount);
  const description = String(req.body.description || "Pix fictício").trim().slice(0, 80);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000)
    return res.status(400).json({ error: "Valor inválido." });

  const from = db.prepare("SELECT * FROM users WHERE id=?").get(fromId);
  const to = db.prepare("SELECT * FROM users WHERE pix_key=?").get(key);

  if (!from) return res.status(404).json({ error: "Remetente não encontrado." });
  if (!to) return res.status(404).json({ error: "Chave Pix não encontrada." });
  if (from.id === to.id) return res.status(400).json({ error: "Você não pode enviar Pix para si mesmo." });
  if (Number(from.balance) < amount) return res.status(400).json({ error: "Saldo insuficiente." });

  const txId = id();
  const created = now();

  const transfer = db.transaction(() => {
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(amount, from.id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount, to.id);
    db.prepare(`
      INSERT INTO transactions(id,from_user_id,to_user_id,amount,description,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(txId, from.id, to.id, amount, description || "Pix fictício", created);
    db.prepare(`
      INSERT INTO notifications(user_id,title,body,created_at)
      VALUES(?,?,?,?)
    `).run(to.id, "Pix recebido", `${from.display_name} enviou R$ ${amount.toFixed(2)} para você.`, created);
  });
  transfer();

  const updatedFrom = db.prepare("SELECT * FROM users WHERE id=?").get(from.id);
  res.json({
    ok: true,
    transactionId: txId,
    createdAt: created,
    from: publicUser(updatedFrom),
    to: { displayName: to.display_name, username: to.username, pixKey: to.pix_key },
    amount,
    description
  });
});

app.post("/api/notifications/read", (req, res) => {
  const userId = String(req.body.userId || "");
  db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").run(userId);
  res.json({ ok: true });
});

app.get("/api/pix/qr", async (req, res) => {
  const key = normalizePixKey(req.query.key);
  const user = db.prepare("SELECT * FROM users WHERE pix_key=?").get(key);
  if (!user) return res.status(404).json({ error: "Chave Pix não encontrada." });

  const payload = JSON.stringify({
    type: "FICTIBANK_PIX",
    pixKey: user.pix_key,
    name: user.display_name
  });
  const dataUrl = await QRCode.toDataURL(payload, { width: 500, margin: 2 });
  res.json({ pixKey: user.pix_key, name: user.display_name, qr: dataUrl });
});

app.get("/api/users", (_, res) => {
  const users = db.prepare("SELECT username,display_name,pix_key FROM users ORDER BY username").all();
  res.json({ users });
});

app.get(/.*/, (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`FictiBank V7.2 online na porta ${PORT}`));