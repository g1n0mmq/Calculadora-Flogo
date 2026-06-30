import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:3001/api';
const ADMIN_PASSWORD = "1234";

const App = () => {
  // Datos Generales
  const [cart, setCart] = useState([]);
  const [products, setProducts] = useState([]);
  const [promos, setPromos] = useState([]);
  const [clientType, setClientType] = useState('particular');
  
  // Facturación
  const [isDelivery, setIsDelivery] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [isDiscount, setIsDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [isRounded, setIsRounded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // UI Catálogo
  const [activeQtyId, setActiveQtyId] = useState(null);
  const [localQty, setLocalQty] = useState(1);
  
  // Admin Global
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState('productos'); 
  
  // Admin Productos
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({ 
    cod_producto: '', name: '', category: '', 
    price_particular: '', price_caf_rest: '', price_negocio: '', price_gimnasio: ''
  });
  const [formFile, setFormFile] = useState(null);

  // Admin Promos
  const [promoForm, setPromoForm] = useState({ description: '', promo_price: '' });
  const [promoItems, setPromoItems] = useState([]);
  const [promoDraftProduct, setPromoDraftProduct] = useState('');
  const [promoDraftQty, setPromoDraftQty] = useState(1);

  // Admin Historial
  const [ventasHistory, setVentasHistory] = useState([]);
  const [expandedVentaId, setExpandedVentaId] = useState(null);

  const fetchData = async () => {
    try {
      const pRes = await fetch(`${API_BASE_URL}/productos`);
      if (pRes.ok) setProducts(await pRes.json());
      
      const prRes = await fetch(`${API_BASE_URL}/promos`);
      if (prRes.ok) setPromos(await prRes.json());

      if (isAdmin) {
        const vRes = await fetch(`${API_BASE_URL}/admin/ventas`);
        if (vRes.ok) setVentasHistory(await vRes.json());
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

  // Función segura para evitar que valores nulos rompan la app
  const getPriceByClient = (product) => {
    if (!product) return 0;
    let price = 0;
    switch (clientType) {
      case 'caf_rest': price = product.price_caf_rest; break;
      case 'negocio': price = product.price_negocio; break;
      case 'gimnasio': price = product.price_gimnasio; break;
      default: price = product.price_particular; break;
    }
    return Number(price) || 0;
  };

  const addToCart = (product, qty) => {
    const existingIndex = cart.findIndex(item => item.id === product.id);
    if (existingIndex > -1) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += qty;
      setCart(newCart);
    } else {
      setCart([...cart, { ...product, quantity: qty }]);
    }
    setActiveQtyId(null);
    setLocalQty(1);
  };

  const updateCartQty = (id, delta) => {
    setCart(prev => prev.map(item => 
      item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
    ).filter(item => item.quantity > 0));
  };

  // ==========================
  // MOTOR MATEMÁTICO (CORREGIDO)
  // ==========================
  let tempCart = cart.map(item => ({ ...item })); 
  let totalPromoDiscount = 0;
  let promoProductIds = new Set(); 

  promos.forEach(promo => {
    let maxApplies = Infinity;
    
    // 1. Ver cuántas veces entra la promo entera
    promo.items.forEach(pItem => {
      const cartItem = tempCart.find(ci => ci.id === pItem.producto_id);
      if (!cartItem) { 
        maxApplies = 0; 
      } else {
        const applies = Math.floor(cartItem.quantity / pItem.quantity);
        if (applies < maxApplies) maxApplies = applies;
      }
    });

    if (maxApplies > 0 && maxApplies !== Infinity) {
      let normalPriceOfItems = 0;
      
      // 2. Calcular cuánto saldría sin promo de forma segura
      promo.items.forEach(pItem => {
        const originalProduct = products.find(p => p.id === pItem.producto_id);
        if (originalProduct) {
          normalPriceOfItems += (getPriceByClient(originalProduct) * pItem.quantity);
        }
      });
      
      const discountPerPromo = normalPriceOfItems - promo.promo_price;
      
      // 3. SOLO APLICAR SI ES UN DESCUENTO REAL (Evita que sume plata a mayoristas)
      if (discountPerPromo > 0) {
        totalPromoDiscount += (discountPerPromo * maxApplies);
        
        promo.items.forEach(pItem => {
          const cartItem = tempCart.find(ci => ci.id === pItem.producto_id);
          if (cartItem) {
            cartItem.quantity -= (pItem.quantity * maxApplies);
            promoProductIds.add(cartItem.id);
          }
        });
      }
    }
  });

  const rawSubtotal = cart.reduce((acc, item) => acc + (getPriceByClient(item) * item.quantity), 0);
  const subtotalAfterPromos = rawSubtotal - totalPromoDiscount;
  
  const manualDiscountAmount = isDiscount ? (subtotalAfterPromos * (discountPercent / 100)) : 0;
  const deliveryAmount = isDelivery ? Number(deliveryFee) : 0;
  let finalTotal = subtotalAfterPromos - manualDiscountAmount + deliveryAmount;
  
  if (isDiscount && isRounded) {
    finalTotal = Math.round(finalTotal / 500) * 500;
  }

  // ==========================
  // FINALIZAR VENTA
  // ==========================
  const handleCheckout = async () => {
    if (cart.length === 0 || isProcessing) return;
    setIsProcessing(true);
    
    const processedCart = cart.map(item => ({
      ...item, 
      appliedPrice: getPriceByClient(item)
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: processedCart,
          clientType,
          subtotal: rawSubtotal,
          delivery: deliveryAmount,
          promo_discount: totalPromoDiscount,
          discount: manualDiscountAmount,
          total: finalTotal
        })
      });

      if (!response.ok) throw new Error('Error al registrar venta');
      
      setCart([]);
      setIsDelivery(false); setDeliveryFee(0);
      setIsDiscount(false); setDiscountPercent(0); setIsRounded(false);
      alert("Pedido registrado exitosamente.");
      if (isAdmin) fetchData();
    } catch (error) {
      alert("Error al procesar la venta.");
    } finally {
      setIsProcessing(false);
    }
  };

  // ==========================
  // FUNCIONES ADMIN
  // ==========================
  const handleAdminToggle = () => {
    if (isAdmin) {
      setIsAdmin(false);
    } else {
      const pass = prompt("Ingrese la clave (1234):");
      if (pass === ADMIN_PASSWORD) setIsAdmin(true);
      else alert("Clave incorrecta.");
    }
  };

  // CRUD PRODUCTOS
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.price_particular) return alert("Faltan campos obligatorios (Nombre y Precio Particular).");
    const data = new FormData();
    const basePrice = formData.price_particular;
    data.append('cod_producto', formData.cod_producto || '');
    data.append('name', formData.name);
    data.append('category', formData.category || '');
    data.append('price_particular', basePrice);
    data.append('price_caf_rest', formData.price_caf_rest || basePrice);
    data.append('price_negocio', formData.price_negocio || basePrice);
    data.append('price_gimnasio', formData.price_gimnasio || basePrice);
    if (formFile) data.append('image', formFile);

    try {
      let response;
      if (editingProduct) {
        response = await fetch(`${API_BASE_URL}/admin/productos/${editingProduct.id}`, { method: 'PUT', body: data });
      } else {
        response = await fetch(`${API_BASE_URL}/admin/productos`, { method: 'POST', body: data });
      }
      if (!response.ok) throw new Error('Fallo al guardar');
      alert("Producto Guardado.");
      setFormData({ cod_producto: '', name: '', category: '', price_particular: '', price_caf_rest: '', price_negocio: '', price_gimnasio: '' });
      setEditingProduct(null);
      fetchData();
    } catch (error) { alert("Error."); }
  };

  const handleDeleteProduct = async (id) => {
    if (!window.confirm("¿Eliminar producto?")) return;
    try {
      await fetch(`${API_BASE_URL}/admin/productos/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) { alert("Error."); }
  };

  // CRUD PROMOS
  const handleAddPromoItem = () => {
    if (!promoDraftProduct || promoDraftQty < 1) return;
    const prod = products.find(p => p.id === parseInt(promoDraftProduct));
    setPromoItems([...promoItems, { producto_id: prod.id, name: prod.name, quantity: promoDraftQty }]);
    setPromoDraftProduct('');
    setPromoDraftQty(1);
  };

  const handleSavePromo = async () => {
    if (!promoForm.description || !promoForm.promo_price || promoItems.length === 0) return alert("Complete los datos e ítems de la promo.");
    try {
      const res = await fetch(`${API_BASE_URL}/admin/promos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: promoForm.description,
          promo_price: promoForm.promo_price,
          items: promoItems
        })
      });
      if (!res.ok) throw new Error('Fallo');
      alert("Promo Creada.");
      setPromoForm({ description: '', promo_price: '' });
      setPromoItems([]);
      fetchData();
    } catch (error) { alert("Error."); }
  };

  const handleDeletePromo = async (id) => {
    if (!window.confirm("¿Eliminar promo?")) return;
    try {
      await fetch(`${API_BASE_URL}/admin/promos/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) { alert("Error."); }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900">
      <header className="bg-white border-b sticky top-0 z-40 px-8 py-4 flex justify-between items-center shadow-sm">
        <h1 className="text-xl font-black tracking-tighter text-amber-600">PANADERÍA LOCAL</h1>
        
        <div className="flex gap-4 items-center">
          {!isAdmin && (
            <select value={clientType} onChange={(e) => setClientType(e.target.value)} className="border-slate-300 rounded-lg p-2 text-sm font-bold bg-slate-50 focus:ring-amber-500 border">
              <option value="particular">Particular</option>
              <option value="caf_rest">Caf/Rest</option>
              <option value="negocio">Negocio</option>
              <option value="gimnasio">Gimnasio</option>
            </select>
          )}

          <button onClick={handleAdminToggle} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-colors ${isAdmin ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}>
            {isAdmin ? "Cerrar Panel" : "Modo Admin"}
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 flex flex-col gap-6">
        
        {/* ================= PANEL ADMINISTRADOR ================= */}
        {isAdmin ? (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex border-b bg-slate-50">
              <button onClick={() => setAdminTab('productos')} className={`flex-1 py-4 font-black text-sm uppercase ${adminTab === 'productos' ? 'bg-white text-amber-600 border-b-2 border-amber-600' : 'text-slate-400 hover:bg-slate-100'}`}>Productos</button>
              <button onClick={() => setAdminTab('promos')} className={`flex-1 py-4 font-black text-sm uppercase ${adminTab === 'promos' ? 'bg-white text-amber-600 border-b-2 border-amber-600' : 'text-slate-400 hover:bg-slate-100'}`}>Promociones</button>
              <button onClick={() => setAdminTab('historial')} className={`flex-1 py-4 font-black text-sm uppercase ${adminTab === 'historial' ? 'bg-white text-amber-600 border-b-2 border-amber-600' : 'text-slate-400 hover:bg-slate-100'}`}>Historial Ventas</button>
            </div>

            <div className="p-6">
              
              {/* TAB PRODUCTOS */}
              {adminTab === 'productos' && (
                <div>
                  <h2 className="text-lg font-black mb-4 text-slate-800">{editingProduct ? "⚙️ Editar Producto" : "➕ Añadir Producto"}</h2>
                  <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-8 border-b pb-8">
                    <div><label className="text-xs font-bold mb-1 block">Cód</label><input type="text" value={formData.cod_producto} onChange={e=>setFormData({...formData, cod_producto: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    <div className="md:col-span-2"><label className="text-xs font-bold mb-1 block">Nombre</label><input type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    <div className="md:col-span-2"><label className="text-xs font-bold mb-1 block">Categoría</label><input type="text" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    
                    <div><label className="text-xs font-bold mb-1 block">$ Particular</label><input type="number" value={formData.price_particular} onChange={e=>setFormData({...formData, price_particular: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    <div><label className="text-xs font-bold mb-1 block">$ Caf/Rest</label><input type="number" value={formData.price_caf_rest} onChange={e=>setFormData({...formData, price_caf_rest: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    <div><label className="text-xs font-bold mb-1 block">$ Negocio</label><input type="number" value={formData.price_negocio} onChange={e=>setFormData({...formData, price_negocio: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    <div><label className="text-xs font-bold mb-1 block">$ Gimnasio</label><input type="number" value={formData.price_gimnasio} onChange={e=>setFormData({...formData, price_gimnasio: e.target.value})} className="w-full p-2 bg-slate-50 border rounded-lg" /></div>
                    
                    <div><label className="text-xs font-bold mb-1 block">Imagen</label><input type="file" onChange={e=>setFormFile(e.target.files[0])} className="w-full text-xs" /></div>
                    
                    <div className="col-span-5 flex justify-end gap-2">
                      {editingProduct && <button type="button" onClick={() => {setEditingProduct(null); setFormData({cod_producto:'', name:'', category:'', price_particular:'', price_caf_rest:'', price_negocio:'', price_gimnasio:''})}} className="px-4 py-2 font-bold text-slate-500">Cancelar</button>}
                      <button type="submit" className="px-6 py-2 bg-amber-600 text-white font-bold rounded-lg">{editingProduct ? "Guardar" : "Insertar"}</button>
                    </div>
                  </form>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {products.map(p => (
                      <div key={p.id} className="p-3 border rounded-xl flex justify-between items-center bg-slate-50">
                        <div>
                          <p className="text-sm font-bold truncate max-w-[150px]">{p.name}</p>
                          <p className="text-xs text-slate-500">${p.price_particular}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => {setEditingProduct(p); setFormData({...p})}} className="text-slate-600 hover:text-amber-600">⚙️</button>
                          <button onClick={() => handleDeleteProduct(p.id)} className="text-red-500">🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB PROMOS */}
              {adminTab === 'promos' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h2 className="text-lg font-black mb-4 text-slate-800">Crear Promo (Combo)</h2>
                    <div className="space-y-4 bg-slate-50 p-4 border rounded-2xl">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="text-xs font-bold block mb-1">Elegir Producto</label>
                          <select value={promoDraftProduct} onChange={e=>setPromoDraftProduct(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                            <option value="">-- Seleccionar --</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="w-20">
                          <label className="text-xs font-bold block mb-1">Cant</label>
                          <input type="number" min="1" value={promoDraftQty} onChange={e=>setPromoDraftQty(e.target.value)} className="w-full p-2 border rounded-lg" />
                        </div>
                        <button onClick={handleAddPromoItem} className="bg-slate-800 text-white font-bold p-2 rounded-lg text-sm">Añadir</button>
                      </div>
                      
                      {promoItems.length > 0 && (
                        <div className="bg-white border rounded-lg p-3 text-sm">
                          <p className="font-bold mb-2">Contenido de la Promo:</p>
                          {promoItems.map((pi, idx) => (
                            <div key={idx} className="flex justify-between text-slate-600 border-b last:border-0 py-1">
                              <span>{pi.quantity}x {pi.name}</span>
                              <button onClick={() => setPromoItems(promoItems.filter((_, i) => i !== idx))} className="text-red-500 text-xs">Quitar</button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="pt-4 border-t">
                        <label className="text-xs font-bold block mb-1">Nombre Descriptivo de Promo</label>
                        <input type="text" value={promoForm.description} onChange={e=>setPromoForm({...promoForm, description: e.target.value})} placeholder="Ej: Promo 3 Panes" className="w-full p-2 border rounded-lg mb-3" />
                        
                        <label className="text-xs font-bold block mb-1">Precio Total Promocional ($)</label>
                        <input type="number" value={promoForm.promo_price} onChange={e=>setPromoForm({...promoForm, promo_price: e.target.value})} placeholder="Ej: 10000" className="w-full p-2 border rounded-lg mb-3 font-black text-amber-600" />
                        
                        <button onClick={handleSavePromo} className="w-full py-3 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700">Guardar Promoción</button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h2 className="text-lg font-black mb-4 text-slate-800">Promociones Activas</h2>
                    <div className="space-y-3">
                      {promos.length === 0 && <p className="text-sm text-slate-400">No hay promos creadas.</p>}
                      {promos.map(p => (
                        <div key={p.id} className="border border-amber-200 bg-amber-50 rounded-xl p-4 flex justify-between items-center">
                          <div>
                            <h4 className="font-black text-amber-800">{p.description} <span className="text-sm text-amber-600">(${p.promo_price})</span></h4>
                            <p className="text-xs text-amber-700/70 mt-1">
                              Requiere: {p.items.map(i => `${i.quantity}x ${products.find(prod=>prod.id === i.producto_id)?.name}`).join(', ')}
                            </p>
                          </div>
                          <button onClick={() => handleDeletePromo(p.id)} className="text-red-500 hover:bg-red-100 p-2 rounded text-sm">🗑️</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB HISTORIAL */}
              {adminTab === 'historial' && (
                <div>
                  <h2 className="text-lg font-black mb-4 text-slate-800">Registro de Pedidos</h2>
                  <div className="space-y-3">
                    {ventasHistory.map(venta => (
                      <div key={venta.id} className="border rounded-xl overflow-hidden bg-white">
                        <div 
                          className="flex justify-between items-center p-4 bg-slate-50 cursor-pointer hover:bg-slate-100"
                          onClick={() => setExpandedVentaId(expandedVentaId === venta.id ? null : venta.id)}
                        >
                          <div>
                            <span className="font-black text-sm block">Venta #{venta.id} - {new Date(venta.fecha).toLocaleString()}</span>
                            <span className="text-xs font-bold text-amber-600 uppercase">Cliente: {venta.client_type.replace('_', ' ')}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-lg font-black text-slate-800">${venta.total.toLocaleString('es-AR')}</span>
                            <span className="block text-xs text-slate-400">{expandedVentaId === venta.id ? 'Ocultar ▲' : 'Ver detalle ▼'}</span>
                          </div>
                        </div>
                        
                        {expandedVentaId === venta.id && (
                          <div className="p-4 border-t bg-white text-sm">
                            <p className="font-bold text-slate-400 mb-2 text-xs uppercase">Ítems comprados</p>
                            {venta.items.map(item => (
                              <div key={item.id} className="flex justify-between border-b border-dashed py-1 text-slate-600">
                                <span>{item.quantity}x {item.name}</span>
                                <span className="font-medium">${(item.price * item.quantity).toLocaleString('es-AR')}</span>
                              </div>
                            ))}
                            
                            <div className="mt-4 space-y-1 text-right text-xs">
                              <p className="text-slate-500">Subtotal bruto: <span className="font-bold w-20 inline-block">${venta.subtotal.toLocaleString('es-AR')}</span></p>
                              {venta.promo_discount > 0 && <p className="text-amber-600">Desc. Promos: <span className="font-bold w-20 inline-block">-${venta.promo_discount.toLocaleString('es-AR')}</span></p>}
                              {venta.discount > 0 && <p className="text-green-600">Desc. Manual: <span className="font-bold w-20 inline-block">-${venta.discount.toLocaleString('es-AR')}</span></p>}
                              {venta.delivery > 0 && <p className="text-blue-600">Envío: <span className="font-bold w-20 inline-block">+${venta.delivery.toLocaleString('es-AR')}</span></p>}
                              <p className="text-base font-black text-slate-800 pt-2 border-t mt-2">Total Final: <span className="w-24 inline-block text-amber-600">${venta.total.toLocaleString('es-AR')}</span></p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          
        /* ================= VISTA DE VENTAS (FRONTEND) ================= */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map(product => (
                <div key={product.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm relative">
                  <img src={product.image || 'https://via.placeholder.com/400x300?text=Panadería'} alt={product.name} className="h-48 w-full object-cover" />
                  <div className="p-5">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">
                          {product.category} {product.cod_producto && `| Cód: ${product.cod_producto}`}
                        </div>
                        <h3 className="text-lg font-bold truncate max-w-[180px]">{product.name}</h3>
                        <p className="text-slate-500 font-bold mb-4">${getPriceByClient(product).toLocaleString('es-AR')}</p>
                      </div>
                    </div>
                    <button onClick={() => { setActiveQtyId(product.id); setLocalQty(1); }} className="w-full py-3 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-black">Seleccionar</button>
                  </div>

                  {activeQtyId === product.id && (
                    <div className="absolute inset-0 bg-white/95 backdrop-blur-sm p-6 flex flex-col justify-center items-center">
                      <div className="flex items-center gap-6 mb-6">
                        <button onClick={() => setLocalQty(Math.max(1, localQty - 1))} className="w-12 h-12 rounded-full bg-slate-100 font-bold hover:bg-slate-200">-</button>
                        <span className="text-3xl font-black">{localQty}</span>
                        <button onClick={() => setLocalQty(localQty + 1)} className="w-12 h-12 rounded-full bg-slate-100 font-bold hover:bg-slate-200">+</button>
                      </div>
                      <div className="flex gap-2 w-full">
                        <button onClick={() => setActiveQtyId(null)} className="flex-1 py-3 font-bold text-slate-500 hover:text-slate-700">Cancelar</button>
                        <button onClick={() => addToCart(product, localQty)} className="flex-[2] py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700">Añadir</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col h-[calc(100vh-140px)] sticky top-28">
              <div className="p-6 border-b flex justify-between items-center bg-slate-50 rounded-t-3xl">
                <h2 className="font-black text-lg">Ticket de Venta</h2>
                <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-1 rounded font-bold">{cart.length} ITEMS</span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">Carrito Vacío</div>
                ) : (
                  cart.map(item => {
                    const isPromo = promoProductIds.has(item.id);
                    return (
                      <div key={item.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${isPromo ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold truncate text-slate-800">
                            {item.name} {isPromo && <span className="text-[10px] text-amber-600 font-black ml-1">(PROMO)</span>}
                          </h4>
                          <p className="text-[10px] font-bold text-slate-400">${getPriceByClient(item).toLocaleString('es-AR')} /u</p>
                        </div>
                        <div className="flex items-center bg-white rounded-lg border">
                          <button onClick={() => updateCartQty(item.id, -1)} className="w-7 h-7 font-bold text-slate-400 hover:text-amber-600">-</button>
                          <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                          <button onClick={() => updateCartQty(item.id, 1)} className="w-7 h-7 font-bold text-slate-400 hover:text-amber-600">+</button>
                        </div>
                        <div className="text-right font-black text-sm w-20 text-slate-800">
                          ${(getPriceByClient(item) * item.quantity).toLocaleString('es-AR')}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="p-5 bg-slate-50 border-t space-y-3 rounded-b-3xl">
                <div className="space-y-1 text-sm font-bold text-slate-500 mb-4">
                  <div className="flex justify-between">
                    <span>Subtotal Original</span><span>${rawSubtotal.toLocaleString('es-AR')}</span>
                  </div>
                  {totalPromoDiscount > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Desc. Promociones</span><span>-${totalPromoDiscount.toLocaleString('es-AR')}</span>
                    </div>
                  )}
                  {manualDiscountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Descuento Manual</span><span>-${manualDiscountAmount.toLocaleString('es-AR')}</span>
                    </div>
                  )}
                </div>
                
                <div className="border-t border-slate-200 pt-3">
                  <div className="flex justify-between items-center mb-2">
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold">
                      <input type="checkbox" checked={isDiscount} onChange={(e) => setIsDiscount(e.target.checked)} className="rounded text-amber-600 w-4 h-4" />
                      Extra Descuento (%)
                    </label>
                    {isDiscount && (
                      <input type="number" min="0" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} className="w-16 p-1 text-sm border rounded text-right bg-white" />
                    )}
                  </div>
                  {isDiscount && (
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-500 pl-6">
                      <input type="checkbox" checked={isRounded} onChange={(e) => setIsRounded(e.target.checked)} className="rounded text-amber-600 w-3 h-3" />
                      Redondear al 500 más cercano
                    </label>
                  )}
                </div>

                <div className="border-y border-slate-200 py-3 flex justify-between items-center">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-bold">
                    <input type="checkbox" checked={isDelivery} onChange={(e) => setIsDelivery(e.target.checked)} className="rounded text-amber-600 w-4 h-4" />
                    Tarifa de Envío
                  </label>
                  {isDelivery && (
                    <input type="number" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className="w-24 p-1 text-sm border rounded text-right bg-white" placeholder="$ Monto" />
                  )}
                </div>

                <div className="flex justify-between items-center pt-2">
                  <span className="font-black text-slate-500 text-lg">TOTAL</span>
                  <span className="text-4xl font-black text-amber-600 tracking-tighter">
                    ${finalTotal.toLocaleString('es-AR')}
                  </span>
                </div>

                <button onClick={handleCheckout} disabled={cart.length === 0 || isProcessing} className="w-full py-4 mt-2 bg-slate-900 text-white rounded-xl font-black uppercase text-sm disabled:bg-slate-300 hover:bg-black transition-colors shadow-lg">
                  {isProcessing ? 'Procesando...' : 'Finalizar Venta'}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
};

export default App;