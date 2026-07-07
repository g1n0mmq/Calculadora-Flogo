import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:3001/api';
const ADMIN_PASSWORD = "1234";

const App = () => {
  const [cart, setCart] = useState([]);
  const [products, setProducts] = useState([]);
  const [promos, setPromos] = useState([]);
  const [ventasHistory, setVentasHistory] = useState([]);
  const [clientType, setClientType] = useState('particular');
  
  const [sideTab, setSideTab] = useState('ticket'); 
  const [adminTab, setAdminTab] = useState('productos'); 
  const [expandedVentaId, setExpandedVentaId] = useState(null);
  
  const [isDelivery, setIsDelivery] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [isDiscount, setIsDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [isRounded, setIsRounded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({ cod_producto: '', name: '', category: '', price_particular: '', price_caf_rest: '', price_negocio: '', price_gimnasio: '' });
  const [formFile, setFormFile] = useState(null);

  const [promoForm, setPromoForm] = useState({ description: '', promo_price: '' });
  const [promoItems, setPromoItems] = useState([]);
  const [promoDraftProduct, setPromoDraftProduct] = useState('');
  const [promoDraftQty, setPromoDraftQty] = useState(1);

  const fetchData = async () => {
    try {
      const pRes = await fetch(`${API_BASE_URL}/productos`);
      if (pRes.ok) setProducts(await pRes.json());
      
      const prRes = await fetch(`${API_BASE_URL}/promos`);
      if (prRes.ok) setPromos(await prRes.json());

      const vRes = await fetch(`${API_BASE_URL}/historial`);
      if (vRes.ok) setVentasHistory(await vRes.json());
    } catch (error) {
      console.error("Error de conexión:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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

  const addOneToCart = (product) => {
    const existingIndex = cart.findIndex(item => item.id === product.id);
    if (existingIndex > -1) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      setCart(newCart);
    } else setCart([...cart, { ...product, quantity: 1 }]);
    setSideTab('ticket');
  };

  const updateCartQty = (id, delta) => {
    setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter(item => item.quantity > 0));
  };

  const clearCart = () => setCart([]);

  // Motor Matemático de Promociones
  let tempCart = cart.map(item => ({ ...item })); 
  let totalPromoDiscount = 0;
  let promoProductIds = new Set(); 
  let appliedPromosList = []; // Almacena las promos aplicadas para el ticket de WhatsApp

  promos.forEach(promo => {
    let maxApplies = Infinity;
    promo.items.forEach(pItem => {
      const cartItem = tempCart.find(ci => ci.id === pItem.producto_id);
      if (!cartItem) maxApplies = 0; 
      else {
        const applies = Math.floor(cartItem.quantity / pItem.quantity);
        if (applies < maxApplies) maxApplies = applies;
      }
    });

    if (maxApplies > 0 && maxApplies !== Infinity) {
      let normalPriceOfItems = 0;
      promo.items.forEach(pItem => {
        const originalProduct = products.find(p => p.id === pItem.producto_id);
        if (originalProduct) normalPriceOfItems += (getPriceByClient(originalProduct) * pItem.quantity);
      });
      
      const discountPerPromo = normalPriceOfItems - promo.promo_price;
      if (discountPerPromo > 0) {
        const totalDiscountForThisPromo = discountPerPromo * maxApplies;
        totalPromoDiscount += totalDiscountForThisPromo;
        
        appliedPromosList.push({
          description: promo.description,
          discount: totalDiscountForThisPromo
        });

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
  if (isDiscount && isRounded) finalTotal = Math.round(finalTotal / 500) * 500;

  // Nueva función unificada para generar el texto del ticket
  const generateTicketText = (data) => {
    let text = `*TU PEDIDO*\n`;
    
    // Lista de ítems (funciona tanto para cart como para historial)
    data.items.forEach(item => {
      // Si viene de 'ventasHistory', el precio ya es el total por fila
      const linePrice = data.isHistory ? item.price * item.quantity : getPriceByClient(item) * item.quantity;
      text += `- ${item.quantity} ${item.name.toUpperCase()} = *$${linePrice.toLocaleString('es-AR')}*\n`;
    });

    // Descuentos de Promo
    if (data.promo_discount > 0) {
      text += `   🔸 AHORRO COMBOS = -*$${data.promo_discount.toLocaleString('es-AR')}*\n`;
    }

    // Costo de Envío
    if (data.delivery > 0) {
      text += `- Costo de envío = *$${data.delivery.toLocaleString('es-AR')}*\n`;
    }

    // Descuento Manual
    if (data.discount > 0) {
      text += `- Descuentos adicionales = -*$${data.discount.toLocaleString('es-AR')}*\n`;
    }

    // LÓGICA DE CORRECCIÓN: Solo muestra subtotal si hubo descuentos
    const hasDiscounts = data.promo_discount > 0 || data.discount > 0;
    if (hasDiscounts) {
      text += `\nSUBTOTAL SIN DESCUENTOS = *$${data.subtotal.toLocaleString('es-AR')}*\n`;
    }

    text += `*TOTAL = $${data.total.toLocaleString('es-AR')}*\n`;
    return text;
  };

  const handleCheckout = async () => {
    if (cart.length === 0 || isProcessing) return;
    setIsProcessing(true);
    
    const processedCart = cart.map(item => ({ ...item, appliedPrice: getPriceByClient(item) }));

    try {
      const response = await fetch(`${API_BASE_URL}/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: processedCart, clientType, subtotal: rawSubtotal,
          delivery: deliveryAmount, promo_discount: totalPromoDiscount,
          discount: manualDiscountAmount, total: finalTotal
        })
      });

      if (!response.ok) throw new Error('Error al registrar venta');
      clearCart();
      setIsDelivery(false); setDeliveryFee(0);
      setIsDiscount(false); setDiscountPercent(0); setIsRounded(false);
      
      await fetchData();
      setSideTab('historial');
    } catch (error) {
      alert("Error al procesar la venta.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAdminToggle = () => {
    if (isAdmin) setIsAdmin(false);
    else if (prompt("Ingrese la clave (1234):") === ADMIN_PASSWORD) setIsAdmin(true);
    else alert("Clave incorrecta.");
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.price_particular) return alert("Faltan campos obligatorios.");
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
      if (editingProduct) await fetch(`${API_BASE_URL}/admin/productos/${editingProduct.id}`, { method: 'PUT', body: data });
      else await fetch(`${API_BASE_URL}/admin/productos`, { method: 'POST', body: data });
      setFormData({ cod_producto: '', name: '', category: '', price_particular: '', price_caf_rest: '', price_negocio: '', price_gimnasio: '' });
      setEditingProduct(null);
      fetchData();
    } catch (error) { alert("Error."); }
  };

  const handleDeleteProduct = async (id) => {
    if (!window.confirm("¿Eliminar producto?")) return;
    await fetch(`${API_BASE_URL}/admin/productos/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const handleAddPromoItem = () => {
    if (!promoDraftProduct || promoDraftQty < 1) return;
    const prod = products.find(p => p.id === parseInt(promoDraftProduct));
    setPromoItems([...promoItems, { producto_id: prod.id, name: prod.name, quantity: promoDraftQty }]);
    setPromoDraftProduct(''); setPromoDraftQty(1);
  };

  const handleSavePromo = async () => {
    if (!promoForm.description || !promoForm.promo_price || promoItems.length === 0) return alert("Faltan datos.");
    await fetch(`${API_BASE_URL}/admin/promos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: promoForm.description, promo_price: promoForm.promo_price, items: promoItems })
    });
    setPromoForm({ description: '', promo_price: '' });
    setPromoItems([]);
    fetchData();
  };

  const handleDeletePromo = async (id) => {
    if (!window.confirm("¿Eliminar promo?")) return;
    await fetch(`${API_BASE_URL}/admin/promos/${id}`, { method: 'DELETE' });
    fetchData();
  };

  // Botón del carrito (Ticket Activo)
  const handleCopyTicket = () => {
    const data = {
      items: cart,
      subtotal: rawSubtotal,
      delivery: deliveryAmount,
      promo_discount: totalPromoDiscount,
      discount: manualDiscountAmount,
      total: finalTotal,
      isHistory: false
    };
    navigator.clipboard.writeText(generateTicketText(data)).then(() => alert("Copiado!"));
  };
  const handleDeleteVenta = async (id) => {
    if (!window.confirm("¿Eliminar registro de venta permanentemente?")) return;
    await fetch(`${API_BASE_URL}/admin/ventas/${id}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <div className="fixed inset-0 bg-slate-50 font-sans text-slate-900 flex flex-col">
      <header className="flex-none bg-white border-b z-40 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-black tracking-tighter text-amber-600 uppercase">Terminal POS</h1>
          {!isAdmin && (
            <select value={clientType} onChange={(e) => setClientType(e.target.value)} className="bg-slate-100 border border-slate-200 text-sm font-bold text-slate-700 py-2 px-4 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none">
              <option value="particular">Tarifa: Particular</option>
              <option value="caf_rest">Tarifa: Caf/Rest</option>
              <option value="negocio">Tarifa: Negocio</option>
              <option value="gimnasio">Tarifa: Gimnasio</option>
            </select>
          )}
        </div>
        <button onClick={handleAdminToggle} className={`text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors border ${isAdmin ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}>
          {isAdmin ? "Cerrar Panel Admin" : "⚙️ Ajustes Admin"}
        </button>
      </header>

      <main className="flex-1 flex overflow-hidden max-w-[1800px] w-full mx-auto p-4 gap-6">
        
        <section className="flex-[2] flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
            
            {isAdmin ? (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-6">
                <div className="flex border-b mb-6">
                  <button onClick={() => setAdminTab('productos')} className={`pb-3 px-4 font-black text-sm uppercase ${adminTab === 'productos' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-slate-400'}`}>Productos</button>
                  <button onClick={() => setAdminTab('promos')} className={`pb-3 px-4 font-black text-sm uppercase ${adminTab === 'promos' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-slate-400'}`}>Promociones</button>
                </div>

                {adminTab === 'productos' && (
                  <div className="space-y-6">
                    <form onSubmit={handleSaveProduct} className="bg-slate-50 p-6 rounded-2xl grid grid-cols-1 md:grid-cols-4 gap-4 border border-slate-100">
                      <div><label className="text-xs font-bold text-slate-500 block mb-1">Cód</label><input type="text" value={formData.cod_producto} onChange={e=>setFormData({...formData, cod_producto: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div className="md:col-span-2"><label className="text-xs font-bold text-slate-500 block mb-1">Nombre</label><input type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div><label className="text-xs font-bold text-slate-500 block mb-1">Categoría</label><input type="text" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div><label className="text-xs font-bold text-slate-500 block mb-1">$ Partic</label><input type="number" value={formData.price_particular} onChange={e=>setFormData({...formData, price_particular: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div><label className="text-xs font-bold text-slate-500 block mb-1">$ Caf</label><input type="number" value={formData.price_caf_rest} onChange={e=>setFormData({...formData, price_caf_rest: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div><label className="text-xs font-bold text-slate-500 block mb-1">$ Neg</label><input type="number" value={formData.price_negocio} onChange={e=>setFormData({...formData, price_negocio: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div><label className="text-xs font-bold text-slate-500 block mb-1">$ Gim</label><input type="number" value={formData.price_gimnasio} onChange={e=>setFormData({...formData, price_gimnasio: e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg" /></div>
                      <div className="md:col-span-2"><label className="text-xs font-bold text-slate-500 block mb-1">Imagen</label><input type="file" onChange={e=>setFormFile(e.target.files[0])} className="w-full text-xs text-slate-500" /></div>
                      <div className="md:col-span-2 flex justify-end items-end gap-3">
                        {editingProduct && <button type="button" onClick={() => {setEditingProduct(null); setFormData({cod_producto:'', name:'', category:'', price_particular:'', price_caf_rest:'', price_negocio:'', price_gimnasio:''})}} className="px-4 py-2 text-sm font-bold text-slate-500">Cancelar</button>}
                        <button type="submit" className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-md">{editingProduct ? "Actualizar" : "Insertar Producto"}</button>
                      </div>
                    </form>

                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                      {products.map(p => (
                        <div key={p.id} className="bg-white p-3 rounded-2xl flex justify-between items-center border border-slate-200 shadow-sm">
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-sm font-bold truncate text-slate-800">{p.name}</p>
                            <p className="text-xs font-semibold text-amber-600">${p.price_particular}</p>
                          </div>
                          <div className="flex flex-col gap-1">
                            <button onClick={() => {setEditingProduct(p); setFormData({...p})}} className="text-xs bg-slate-100 hover:bg-slate-200 p-1.5 rounded-md">⚙️</button>
                            <button onClick={() => handleDeleteProduct(p.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-500 p-1.5 rounded-md">🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminTab === 'promos' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-slate-50 p-6 border border-slate-100 rounded-2xl">
                      <h3 className="font-black text-slate-700 mb-4 uppercase text-sm tracking-wider">Armar Combo</h3>
                      <div className="flex gap-2 items-end mb-4">
                        <div className="flex-1">
                          <label className="text-xs font-bold text-slate-500 block mb-1">Elegir Producto</label>
                          <select value={promoDraftProduct} onChange={e=>setPromoDraftProduct(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg bg-white">
                            <option value="">Seleccione</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="w-20">
                          <label className="text-xs font-bold text-slate-500 block mb-1">Cant</label>
                          <input type="number" min="1" value={promoDraftQty} onChange={e=>setPromoDraftQty(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg bg-white" />
                        </div>
                        <button onClick={handleAddPromoItem} className="p-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg text-sm">Añadir</button>
                      </div>

                      <div className="mb-4 bg-white border border-slate-200 rounded-lg p-3 min-h-[60px]">
                        {promoItems.map((pi, i) => (
                          <div key={i} className="flex justify-between text-sm py-1 border-b last:border-0 border-slate-100 text-slate-600">
                            <span>{pi.quantity}x {pi.name}</span>
                            <button onClick={() => setPromoItems(promoItems.filter((_, idx) => idx !== i))} className="text-red-500 text-xs font-bold">X</button>
                          </div>
                        ))}
                      </div>

                      <label className="text-xs font-bold text-slate-500 block mb-1">Nombre Promo</label>
                      <input type="text" value={promoForm.description} onChange={e=>setPromoForm({...promoForm, description: e.target.value})} className="w-full p-2 border border-slate-200 rounded-lg bg-white mb-3" />
                      
                      <label className="text-xs font-bold text-slate-500 block mb-1">Precio Fijo Especial ($)</label>
                      <input type="number" value={promoForm.promo_price} onChange={e=>setPromoForm({...promoForm, promo_price: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg bg-amber-50 font-black text-amber-700 mb-4" />
                      
                      <button onClick={handleSavePromo} className="w-full p-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-md">Guardar Promoción</button>
                    </div>

                    <div>
                      <h3 className="font-black text-slate-700 mb-4 uppercase text-sm tracking-wider">Promos Activas</h3>
                      <div className="space-y-3">
                        {promos.map(p => (
                          <div key={p.id} className="bg-white border border-slate-200 shadow-sm rounded-xl p-4 flex justify-between items-center">
                            <div>
                              <h4 className="font-black text-slate-800">{p.description} <span className="text-amber-600 ml-1">${p.promo_price}</span></h4>
                              <p className="text-xs text-slate-500 font-medium mt-1">
                                Incluye: {p.items.map(i => `${i.quantity}x ${products.find(pr=>pr.id===i.producto_id)?.name}`).join(', ')}
                              </p>
                            </div>
                            <button onClick={() => handleDeletePromo(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg">🗑️</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 content-start">
                {products.map(p => (
                  <div 
                    key={p.id} 
                    onClick={() => addOneToCart(p)}
                    className="bg-white rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-1 transition-all border border-slate-200 overflow-hidden cursor-pointer flex flex-col group active:scale-95"
                  >
                    <div className="relative h-28 w-full overflow-hidden bg-slate-100 shrink-0">
                      <img src={p.image || 'https://via.placeholder.com/200?text=Panadería'} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    </div>
                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[9px] font-black text-amber-600 uppercase tracking-wider mb-1 truncate">{p.category} {p.cod_producto && `- ${p.cod_producto}`}</div>
                        <h3 className="text-sm font-bold text-slate-800 leading-tight line-clamp-2">{p.name}</h3>
                      </div>
                      <div className="text-sm font-black text-slate-600 mt-2">
                        ${getPriceByClient(p).toLocaleString('es-AR')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="w-full max-w-sm lg:max-w-md flex flex-col overflow-hidden min-w-0">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-200 flex flex-col flex-1 min-h-0 overflow-hidden">
            
            <div className="flex shrink-0 border-b border-slate-200 bg-slate-50">
              <button onClick={() => setSideTab('ticket')} className={`flex-1 py-4 font-black text-sm uppercase transition-colors relative ${sideTab === 'ticket' ? 'text-amber-600 bg-white' : 'text-slate-400 hover:bg-slate-100'}`}>
                Ticket Activo
                {sideTab === 'ticket' && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-amber-500 rounded-t"></div>}
              </button>
              <button onClick={() => setSideTab('historial')} className={`flex-1 py-4 font-black text-sm uppercase transition-colors relative ${sideTab === 'historial' ? 'text-amber-600 bg-white' : 'text-slate-400 hover:bg-slate-100'}`}>
                Historial
                {sideTab === 'historial' && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-amber-500 rounded-t"></div>}
              </button>
            </div>

            <div className="flex-1 flex flex-col min-h-0 relative bg-slate-50/50">
              
              {sideTab === 'ticket' && (
                <div className="flex flex-col h-full w-full absolute inset-0">
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                    {cart.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-slate-400 text-sm font-medium italic">Agregue productos para comenzar</div>
                    ) : (
                      cart.map(item => {
                        const isPromo = promoProductIds.has(item.id);
                        return (
                          <div key={item.id} className={`flex items-center gap-3 p-3 rounded-2xl border bg-white shadow-sm shrink-0 ${isPromo ? 'border-amber-200 bg-amber-50/30' : 'border-slate-100'}`}>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-bold truncate text-slate-800">
                                {item.name} {isPromo && <span className="text-[9px] text-amber-600 font-black ml-1 bg-amber-100 px-1 py-0.5 rounded uppercase">Promo</span>}
                              </h4>
                              <p className="text-[10px] font-bold text-slate-400">${getPriceByClient(item).toLocaleString('es-AR')} /u</p>
                            </div>
                            <div className="flex items-center bg-slate-50 rounded-lg border border-slate-200">
                              <button onClick={() => updateCartQty(item.id, -1)} className="w-7 h-7 font-bold text-slate-500 hover:text-amber-600">-</button>
                              <span className="w-6 text-center text-xs font-black text-slate-700">{item.quantity}</span>
                              <button onClick={() => updateCartQty(item.id, 1)} className="w-7 h-7 font-bold text-slate-500 hover:text-amber-600">+</button>
                            </div>
                            <div className="text-right font-black text-sm w-[70px] text-slate-800">
                              ${(getPriceByClient(item) * item.quantity).toLocaleString('es-AR')}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  <div className="shrink-0 p-5 bg-white border-t border-slate-200 space-y-3 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
                    <div className="space-y-1.5 text-sm font-bold text-slate-500 mb-4">
                      <div className="flex justify-between"><span>Subtotal Original</span><span>${rawSubtotal.toLocaleString('es-AR')}</span></div>
                      {totalPromoDiscount > 0 && <div className="flex justify-between text-amber-600"><span>Ahorro Combos</span><span>-${totalPromoDiscount.toLocaleString('es-AR')}</span></div>}
                      {manualDiscountAmount > 0 && <div className="flex justify-between text-green-600"><span>Desc. Manual</span><span>-${manualDiscountAmount.toLocaleString('es-AR')}</span></div>}
                    </div>
                    
                    <div className="border-t border-slate-100 pt-3">
                      <div className="flex justify-between items-center mb-2">
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700">
                          <input type="checkbox" checked={isDiscount} onChange={(e) => setIsDiscount(e.target.checked)} className="rounded text-amber-600 w-4 h-4" /> Descuento (%)
                        </label>
                        {isDiscount && <input type="number" min="0" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} className="w-16 p-1 text-sm border border-slate-300 rounded text-right bg-white focus:ring-1 focus:ring-amber-500 outline-none" />}
                      </div>
                      {isDiscount && (
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-400 pl-6">
                          <input type="checkbox" checked={isRounded} onChange={(e) => setIsRounded(e.target.checked)} className="rounded text-amber-600 w-3 h-3" /> Auto-redondear a $500
                        </label>
                      )}
                    </div>

                    <div className="border-y border-slate-100 py-3 flex justify-between items-center">
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700">
                        <input type="checkbox" checked={isDelivery} onChange={(e) => setIsDelivery(e.target.checked)} className="rounded text-amber-600 w-4 h-4" /> Tarifa Delivery
                      </label>
                      {isDelivery && <input type="number" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className="w-20 p-1 text-sm border border-slate-300 rounded text-right bg-white focus:ring-1 focus:ring-amber-500 outline-none" placeholder="$" />}
                    </div>

                    <div className="flex justify-between items-end pt-2">
                      <span className="font-black text-slate-400 text-xs uppercase tracking-widest mb-1">Total Final</span>
                      <span className="text-4xl font-black text-amber-600 tracking-tighter">${finalTotal.toLocaleString('es-AR')}</span>
                    </div>

                    {/* BOTÓN NUEVO: COPIAR PARA WHATSAPP */}
                    <button 
                      onClick={handleCopyTicket} 
                      disabled={cart.length === 0} 
                      className="w-full py-2 bg-[#25D366] hover:bg-[#1DA851] text-white rounded-lg font-bold text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      COPIAR PARA WHATSAPP
                    </button>

                    <div className="flex gap-2 pt-1">
                      <button onClick={clearCart} disabled={cart.length === 0} className="w-16 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl disabled:opacity-50 transition-colors">CE</button>
                      <button onClick={handleCheckout} disabled={cart.length === 0 || isProcessing} className="flex-1 py-4 bg-slate-900 text-white rounded-xl font-black uppercase text-sm disabled:bg-slate-300 hover:bg-black transition-colors shadow-lg shadow-slate-200">
                        {isProcessing ? 'Procesando...' : 'Cobrar Ticket'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sideTab === 'historial' && (
                <div className="absolute inset-0 p-4 overflow-y-auto custom-scrollbar space-y-3">
                  {ventasHistory.length === 0 ? (
                    <div className="text-center text-slate-400 text-sm font-medium italic mt-10">El registro está vacío.</div>
                  ) : (
                    ventasHistory.map(venta => (
                      <div key={venta.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm shrink-0">
                        <div 
                          className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => setExpandedVentaId(expandedVentaId === venta.id ? null : venta.id)}
                        >
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xl font-black text-slate-800">${venta.total.toLocaleString('es-AR')}</span>
                            <div className="flex gap-2">
                               <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  const data = { ...venta, isHistory: true }; // Prepara los datos del historial
                                  navigator.clipboard.writeText(generateTicketText(data)); 
                                  alert("Copiado!"); 
                                }} 
                                className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-bold hover:bg-green-200">COPIAR</button>
                               {isAdmin && <button onClick={(e) => { e.stopPropagation(); handleDeleteVenta(venta.id); }} className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded font-bold hover:bg-red-200">ELIMINAR</button>}
                            </div>
                          </div>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded uppercase tracking-wider">{venta.client_type.replace('_', ' ')}</span>
                            <span className="text-[10px] font-bold text-slate-400">#{venta.id.toString().padStart(4, '0')} - {new Date(venta.fecha).toLocaleDateString()} {new Date(venta.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                        </div>
                        
                        {expandedVentaId === venta.id && (
                          <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50 text-xs text-slate-600">
                            <p className="font-black text-slate-400 mb-2 uppercase tracking-wider text-[10px]">Detalle</p>
                            {venta.items.map(item => (
                              <div key={item.id} className="flex justify-between py-1 border-b border-dashed border-slate-200 last:border-0">
                                <span>{item.quantity}x {item.name}</span>
                                <span className="font-bold">${(item.price * item.quantity).toLocaleString('es-AR')}</span>
                              </div>
                            ))}
                            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col items-end gap-1 font-medium">
                              <span className="text-slate-500">Subtotal: ${venta.subtotal.toLocaleString('es-AR')}</span>
                              {venta.promo_discount > 0 && <span className="text-amber-600">Ahorro Promos: -${venta.promo_discount.toLocaleString('es-AR')}</span>}
                              {venta.discount > 0 && <span className="text-green-600">Desc Manual: -${venta.discount.toLocaleString('es-AR')}</span>}
                              {venta.delivery > 0 && <span className="text-slate-700">Envío: +${venta.delivery.toLocaleString('es-AR')}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;