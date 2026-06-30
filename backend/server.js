const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir imágenes estáticas
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// BASE DE DATOS (v5 - Estructura limpia y sin bloqueos)
const dbPath = path.resolve(__dirname, 'panaderia_v5.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos', err);
  } else {
    console.log('Base de datos SQLite v5 conectada correctamente.');
    inicializarTablas();
  }
});

function inicializarTablas() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cod_producto TEXT,
      name TEXT, 
      category TEXT, 
      price_particular REAL,
      price_caf_rest REAL,
      price_negocio REAL,
      price_gimnasio REAL,
      image TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_type TEXT,
      subtotal REAL, 
      delivery REAL, 
      discount REAL,
      promo_discount REAL,
      total REAL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ventas_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER, 
      producto_id INTEGER,
      name TEXT,
      quantity INTEGER, 
      price REAL,
      FOREIGN KEY(venta_id) REFERENCES ventas(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promociones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT,
      promo_price REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promociones_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_id INTEGER,
      producto_id INTEGER,
      quantity INTEGER,
      FOREIGN KEY(promo_id) REFERENCES promociones(id),
      FOREIGN KEY(producto_id) REFERENCES productos(id)
    )`);
  });
}

// =======================
// ENDPOINTS PÚBLICOS
// =======================
app.get('/api/productos', (req, res) => {
  db.all("SELECT * FROM productos", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/promos', (req, res) => {
  db.all("SELECT * FROM promociones", [], (err, promos) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all("SELECT * FROM promociones_items", [], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      const result = promos.map(p => ({
        ...p,
        items: items.filter(i => i.promo_id === p.id)
      }));
      res.json(result);
    });
  });
});

// Guardado de Ventas seguro (Sin bloqueos de Transaction)
app.post('/api/ventas', (req, res) => {
  const { items, clientType, subtotal, delivery, discount, promo_discount, total } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "El carrito está vacío." });

  db.run("INSERT INTO ventas (client_type, subtotal, delivery, discount, promo_discount, total) VALUES (?, ?, ?, ?, ?, ?)", 
  [clientType, subtotal, delivery, discount, promo_discount, total], function(err) {
    if (err) return res.status(500).json({ error: err.message }); 

    const ventaId = this.lastID;
    const stmt = db.prepare("INSERT INTO ventas_items (venta_id, producto_id, name, quantity, price) VALUES (?, ?, ?, ?, ?)");
    
    items.forEach(item => {
      stmt.run([ventaId, item.id, item.name, item.quantity, item.appliedPrice]);
    });

    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: "Venta guardada con éxito", ventaId });
    });
  });
});

// =======================
// ENDPOINTS DE ADMIN
// =======================
app.post('/api/admin/productos', upload.single('image'), (req, res) => {
  const { cod_producto, name, category, price_particular, price_caf_rest, price_negocio, price_gimnasio } = req.body;
  const imageUrl = req.file ? `http://localhost:3001/uploads/${req.file.filename}` : '';

  db.run(
    "INSERT INTO productos (cod_producto, name, category, price_particular, price_caf_rest, price_negocio, price_gimnasio, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [cod_producto, name, category, parseFloat(price_particular), parseFloat(price_caf_rest), parseFloat(price_negocio), parseFloat(price_gimnasio), imageUrl],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, message: "Creado exitosamente" });
    }
  );
});

app.put('/api/admin/productos/:id', upload.single('image'), (req, res) => {
  const { id } = req.params;
  const { cod_producto, name, category, price_particular, price_caf_rest, price_negocio, price_gimnasio } = req.body;
  
  const queryBase = "UPDATE productos SET cod_producto = ?, name = ?, category = ?, price_particular = ?, price_caf_rest = ?, price_negocio = ?, price_gimnasio = ?";
  const params = [cod_producto, name, category, parseFloat(price_particular), parseFloat(price_caf_rest), parseFloat(price_negocio), parseFloat(price_gimnasio)];

  if (req.file) {
    const imageUrl = `http://localhost:3001/uploads/${req.file.filename}`;
    db.run(`${queryBase}, image = ? WHERE id = ?`, [...params, imageUrl, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Producto actualizado con éxito" });
    });
  } else {
    db.run(`${queryBase} WHERE id = ?`, [...params, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Producto actualizado con éxito" });
    });
  }
});

app.delete('/api/admin/productos/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM productos WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Producto eliminado." });
  });
});

// Guardado de Promociones (Seguro)
app.post('/api/admin/promos', (req, res) => {
  const { description, promo_price, items } = req.body;
  
  db.run("INSERT INTO promociones (description, promo_price) VALUES (?, ?)", [description, parseFloat(promo_price)], function(err) {
    if (err) return res.status(500).json({error: err.message});
    
    const promoId = this.lastID;
    const stmt = db.prepare("INSERT INTO promociones_items (promo_id, producto_id, quantity) VALUES (?, ?, ?)");
    
    items.forEach(item => {
      stmt.run([promoId, item.producto_id, parseInt(item.quantity)]);
    });
    
    stmt.finalize(err => {
      if (err) return res.status(500).json({error: err.message});
      res.json({ message: "Promo creada" });
    });
  });
});

app.delete('/api/admin/promos/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM promociones_items WHERE promo_id = ?", [id], function(err) {
    if (err) return res.status(500).json({error: err.message});
    db.run("DELETE FROM promociones WHERE id = ?", [id], function(err) {
      if (err) return res.status(500).json({error: err.message});
      res.json({ message: "Promo eliminada." });
    });
  });
});

// Obtener Historial de Ventas
app.get('/api/admin/ventas', (req, res) => {
  db.all("SELECT * FROM ventas ORDER BY fecha DESC", [], (err, ventas) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all("SELECT * FROM ventas_items", [], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      const result = ventas.map(v => ({
        ...v,
        items: items.filter(i => i.venta_id === v.id)
      }));
      res.json(result);
    });
  });
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});