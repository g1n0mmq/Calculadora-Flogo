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

// Servir la carpeta de imágenes de forma pública
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración de almacenamiento para Multer
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

// Base de datos SQLite
const dbPath = path.resolve(__dirname, 'panaderia.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos', err);
  } else {
    console.log('Base de datos SQLite conectada correctamente.');
    inicializarTablas();
  }
});

function inicializarTablas() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, 
      category TEXT, 
      price REAL, 
      image TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subtotal REAL, 
      delivery REAL, 
      total REAL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ventas_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER, 
      producto_id INTEGER, 
      quantity INTEGER, 
      price REAL,
      FOREIGN KEY(venta_id) REFERENCES ventas(id)
    )`);
  });
}

// Endpoints Públicos
app.get('/api/productos', (req, res) => {
  db.all("SELECT * FROM productos", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/ventas', (req, res) => {
  const { items, subtotal, delivery, total } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "El carrito está vacío." });

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run("INSERT INTO ventas (subtotal, delivery, total) VALUES (?, ?, ?)", [subtotal, delivery, total], function(err) {
      if (err) { 
        db.run("ROLLBACK"); 
        return res.status(500).json({ error: err.message }); 
      }

      const ventaId = this.lastID;
      const stmt = db.prepare("INSERT INTO ventas_items (venta_id, producto_id, quantity, price) VALUES (?, ?, ?, ?)");
      let errorEnBucle = false;
      
      for (const item of items) {
        stmt.run([ventaId, item.id, item.quantity, item.price], (err) => { 
          if (err) errorEnBucle = true; 
        });
      }

      stmt.finalize((err) => {
        if (err || errorEnBucle) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Error interno al procesar los ítems." });
        } else {
          db.run("COMMIT");
          res.status(201).json({ message: "Venta guardada con éxito", ventaId });
        }
      });
    });
  });
});

// Endpoints de Administración (CRUD)
app.post('/api/admin/productos', upload.single('image'), (req, res) => {
  const { name, category, price } = req.body;
  const imageUrl = req.file ? `http://localhost:3001/uploads/${req.file.filename}` : '';

  db.run(
    "INSERT INTO productos (name, category, price, image) VALUES (?, ?, ?, ?)",
    [name, category, parseFloat(price), imageUrl],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, name, category, price, image: imageUrl });
    }
  );
});

app.put('/api/admin/productos/:id', upload.single('image'), (req, res) => {
  const { id } = req.params;
  const { name, category, price } = req.body;
  
  if (req.file) {
    const imageUrl = `http://localhost:3001/uploads/${req.file.filename}`;
    db.run(
      "UPDATE productos SET name = ?, category = ?, price = ?, image = ? WHERE id = ?",
      [name, category, parseFloat(price), imageUrl, id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Producto actualizado con éxito" });
      }
    );
  } else {
    db.run(
      "UPDATE productos SET name = ?, category = ?, price = ? WHERE id = ?",
      [name, category, parseFloat(price), id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Producto actualizado con éxito" });
      }
    );
  }
});

app.delete('/api/admin/productos/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM productos WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Producto eliminado correctamente." });
  });
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});