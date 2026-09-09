import { useEffect, useRef, useState } from 'react'

type Product = {
  code: string
  name: string
  category: string
  productType: string
  unit: string
  vat: string
  ePoint: string
  volume: string
  weight: string
  active: boolean
}

type ProductGroup = { code: string; name: string }
type ProductType = { code: string; name: string }
type Price = {
  id: number
  productCode: string
  productName: string
  startDate: string
  endDate: string
  purchasePrice: string
  salesPrice: string
  soundReturnPrice: string
  damagedReturnPrice: string
  recommendedSalesPrice: string
  status: string
}
type ProductUnit = { productCode: string; unit: string; innerQuantity: string; barcode: string }
type ModuleAccess = { visible: boolean; actions?: { view?: boolean; create?: boolean; edit?: boolean; delete?: boolean } }

const tabs = ['Ürün Tanımlama', 'Ürün Fiyat Tanımlama', 'Ürün Grup Tanımlama', 'Ürün Tipi Tanımlama']
const emptyProduct = () => ({ code: '', name: '', category: '', productType: '', unit: 'Koli', vat: '%10', ePoint: '', volume: '', weight: '' })
const getYearEnd = (date: string) => date ? `${date.slice(0, 4)}-12-31` : ''

export function ProductDefinitionWindow() {
  const [activeTab, setActiveTab] = useState(tabs[0])
  const [products, setProducts] = useState<Product[]>([])
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [types, setTypes] = useState<ProductType[]>([])
  const [prices, setPrices] = useState<Price[]>([])
  const [productUnits, setProductUnits] = useState<ProductUnit[]>([])
  const [productForm, setProductForm] = useState(emptyProduct)
  const [groupForm, setGroupForm] = useState({ code: '', name: '' })
  const [typeForm, setTypeForm] = useState({ code: '', name: '' })
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [unitDialogOpen, setUnitDialogOpen] = useState(false)
  const [priceDialogOpen, setPriceDialogOpen] = useState(false)
  const [savedProduct, setSavedProduct] = useState<Product | null>(null)
  const [unitForm, setUnitForm] = useState({ unit: 'Adet', innerQuantity: '', barcode: '' })
  const [editingProductCode, setEditingProductCode] = useState<string | null>(null)
  const [editingGroupCode, setEditingGroupCode] = useState<string | null>(null)
  const [editingTypeCode, setEditingTypeCode] = useState<string | null>(null)
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [selectedPriceProductCode, setSelectedPriceProductCode] = useState<string | null>(null)
  const [priceForm, setPriceForm] = useState({ productCode: '', productName: '', startDate: '', endDate: '', purchasePrice: '', salesPrice: '', soundReturnPrice: '', damagedReturnPrice: '', recommendedSalesPrice: '', status: 'Aktif' })
  const previousPriceStartDate = useRef('')
  const [error, setError] = useState('')
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders = (() => {
    try {
      const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}')
      return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' }
    } catch {
      return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' }
    }
  })()
  const [moduleAccess, setModuleAccess] = useState<ModuleAccess>({ visible: true, actions: { view: true, create: true, edit: true, delete: true } })
  const canCreate = moduleAccess.actions?.create !== false
  const canEdit = moduleAccess.actions?.edit !== false
  const canDelete = moduleAccess.actions?.delete !== false

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}') as { username?: string; accountType?: string }
      if (user.accountType !== 'distributor' || !user.username) return
      fetch(`${apiUrl}/security/access-matrix/${encodeURIComponent(user.username)}`, {
        headers: { 'x-vdesgo-account-type': user.accountType, 'x-vdesgo-username': user.username },
      }).then((response) => response.ok ? response.json() : Promise.reject()).then((matrix) => {
        if (matrix?.ProductDefinition) setModuleAccess(matrix.ProductDefinition)
      }).catch(() => undefined)
    } catch { /* use factory defaults */ }
  }, [apiUrl])

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/data/products`, { headers: authHeaders }).then((response) => response.json()),
      fetch(`${apiUrl}/data/productGroups`, { headers: authHeaders }).then((response) => response.json()),
      fetch(`${apiUrl}/data/productTypes`, { headers: authHeaders }).then((response) => response.json()),
      fetch(`${apiUrl}/data/prices`, { headers: authHeaders }).then((response) => response.json()),
      fetch(`${apiUrl}/data/productUnits`, { headers: authHeaders }).then((response) => response.json()),
    ])
      .then(([productData, groupData, typeData, priceData, unitData]) => {
        if (Array.isArray(productData)) setProducts(productData)
        if (Array.isArray(groupData)) setGroups(groupData)
        if (Array.isArray(typeData)) setTypes(typeData)
        if (Array.isArray(priceData)) setPrices(priceData)
        if (Array.isArray(unitData)) setProductUnits(unitData)
      })
      .catch(() => setError('Ürün kayıtları veritabanından alınamadı.'))
  }, [apiUrl])

  useEffect(() => {
    if (priceForm.startDate && priceForm.startDate !== previousPriceStartDate.current) {
      setPriceForm((current) => ({ ...current, endDate: getYearEnd(current.startDate) }))
    }
    previousPriceStartDate.current = priceForm.startDate
  }, [priceForm.startDate])

  const request = async <T,>(method: 'POST' | 'PUT' | 'DELETE', resource: string, data?: unknown): Promise<T> => {
    const response = await fetch(`${apiUrl}/data/${resource}`, {
      method,
      headers: data ? { ...authHeaders, 'Content-Type': 'application/json' } : authHeaders,
      body: data ? JSON.stringify(data) : undefined,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error || 'İşlem tamamlanamadı.')
    }
    if (method === 'DELETE') return undefined as T
    return response.json() as Promise<T>
  }

  const saveProduct = async () => {
    if (!productForm.code.trim() || !productForm.name.trim() || !productForm.category || !productForm.productType) {
      setError('Ürün kodu, ürün adı, ürün grubu ve ürün tipi zorunludur.')
      return
    }
    try {
      const isNewProduct = !editingProductCode
      const saved = await request<Product>(editingProductCode ? 'PUT' : 'POST', `products${editingProductCode ? `/${encodeURIComponent(editingProductCode)}` : ''}`, { ...productForm, active: true })
      setProducts((current) => editingProductCode ? current.map((product) => product.code === editingProductCode ? saved : product) : [...current, saved])
      setError('')
      setProductDialogOpen(false)
      setProductForm(emptyProduct())
      setEditingProductCode(null)
      if (isNewProduct) {
        setSavedProduct(saved)
        setUnitDialogOpen(true)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Ürün kaydedilemedi.')
    }
  }

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`${product.name} ürününü silmek istediğinize emin misiniz?`)) return
    try {
      await request('DELETE', `products/${encodeURIComponent(product.code)}`)
      setProducts((current) => current.filter((item) => item.code !== product.code))
    } catch { setError('Ürün silinemedi.') }
  }

  const addProductUnit = async () => {
    if (!savedProduct || !unitForm.innerQuantity.trim() || !unitForm.barcode.trim()) {
      setError('Birim, iç miktar ve barkod numarası zorunludur.')
      return
    }
    if (productUnits.some((unit) => unit.barcode === unitForm.barcode.trim())) {
      setError('Bu barkod numarası daha önce kullanılmış.')
      return
    }
    try {
      const saved = await request<ProductUnit>('POST', 'productUnits', { productCode: savedProduct.code, ...unitForm, innerQuantity: unitForm.innerQuantity.trim(), barcode: unitForm.barcode.trim() })
      setProductUnits((current) => [...current, saved])
      setUnitForm({ unit: 'Adet', innerQuantity: '', barcode: '' })
      setError('')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Ürün birimi kaydedilemedi.')
    }
  }

  const removeProductUnit = async (unit: ProductUnit) => {
    if (!window.confirm(`${unit.barcode} barkodlu birimi silmek istediğinize emin misiniz?`)) return
    try {
      await request('DELETE', `productUnits/${encodeURIComponent(unit.barcode)}`)
      setProductUnits((current) => current.filter((item) => item.barcode !== unit.barcode))
    } catch {
      setError('Ürün birimi silinemedi.')
    }
  }

  const openPriceForm = (product: Product, price?: Price) => {
    setPriceForm(price ?? { productCode: product.code, productName: product.name, startDate: '', endDate: '', purchasePrice: '', salesPrice: '', soundReturnPrice: '', damagedReturnPrice: '', recommendedSalesPrice: '', status: 'Aktif' })
    previousPriceStartDate.current = price?.startDate ?? ''
    setEditingPriceId(price?.id ?? null)
    setPriceDialogOpen(true)
  }

  const savePrice = async () => {
    if (!priceForm.startDate || !priceForm.purchasePrice || !priceForm.salesPrice || !priceForm.soundReturnPrice || !priceForm.damagedReturnPrice || !priceForm.recommendedSalesPrice) {
      setError('Başlangıç tarihi ve tüm fiyat alanları zorunludur.')
      return
    }
    if (priceForm.endDate && priceForm.endDate < priceForm.startDate) {
      setError('Bitiş tarihi başlangıç tarihinden önce olamaz.')
      return
    }
    try {
      const saved = await request<Price>(editingPriceId ? 'PUT' : 'POST', `prices${editingPriceId ? `/${editingPriceId}` : ''}`, priceForm)
      setPrices((current) => editingPriceId ? current.map((price) => price.id === editingPriceId ? saved : price) : [...current, saved])
      setPriceDialogOpen(false)
      setError('')
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : 'Fiyat kaydedilemedi.') }
  }

  const removePrice = async (price: Price) => {
    if (!window.confirm(`${price.productName} fiyat kaydını silmek istediğinize emin misiniz?`)) return
    try {
      await request('DELETE', `prices/${price.id}`)
      setPrices((current) => current.filter((item) => item.id !== price.id))
    } catch { setError('Fiyat kaydı silinemedi.') }
  }

  const nextCode = (prefix: string, records: Array<{ code: string }>) => `${prefix}-${String(records.reduce((maximum, record) => Math.max(maximum, Number(record.code.match(/\d+/)?.[0]) || 0), 0) + 1).padStart(3, '0')}`

  const saveGroup = async () => {
    if (!groupForm.name.trim()) return setError('Ürün grup adı zorunludur.')
    const code = groupForm.code.trim() || nextCode('GRP', groups)
    try {
      const saved = await request<ProductGroup>(editingGroupCode ? 'PUT' : 'POST', `productGroups${editingGroupCode ? `/${encodeURIComponent(editingGroupCode)}` : ''}`, { code, name: groupForm.name.trim() })
      setGroups((current) => editingGroupCode ? current.map((group) => group.code === editingGroupCode ? saved : group) : [...current, saved])
      setGroupForm({ code: '', name: '' })
      setEditingGroupCode(null)
      setError('')
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : 'Ürün grubu kaydedilemedi.') }
  }

  const saveType = async () => {
    if (!typeForm.name.trim()) return setError('Ürün tipi adı zorunludur.')
    const code = typeForm.code.trim() || nextCode('TIP', types)
    try {
      const saved = await request<ProductType>(editingTypeCode ? 'PUT' : 'POST', `productTypes${editingTypeCode ? `/${encodeURIComponent(editingTypeCode)}` : ''}`, { code, name: typeForm.name.trim() })
      setTypes((current) => editingTypeCode ? current.map((type) => type.code === editingTypeCode ? saved : type) : [...current, saved])
      setTypeForm({ code: '', name: '' })
      setEditingTypeCode(null)
      setError('')
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : 'Ürün tipi kaydedilemedi.') }
  }

  const removeMasterData = async (resource: 'productGroups' | 'productTypes', record: ProductGroup | ProductType) => {
    if (!window.confirm(`${record.name} kaydını silmek istediğinize emin misiniz?`)) return
    try {
      await request('DELETE', `${resource}/${encodeURIComponent(record.code)}`)
      if (resource === 'productGroups') setGroups((current) => current.filter((group) => group.code !== record.code))
      else setTypes((current) => current.filter((type) => type.code !== record.code))
    } catch { setError('Kayıt silinemedi.') }
  }

  const openNewProduct = async () => {
    const response = await fetch(`${apiUrl}/data/products/next-code`)
    if (!response.ok) {
      setError('Yeni ürün kodu alınamadı.')
      return
    }

    const { code } = await response.json() as { code: string }
    setProductForm({ ...emptyProduct(), code })
    setEditingProductCode(null)
    setProductDialogOpen(true)
  }

  const openProductEdit = (product: Product) => {
    setProductForm(product)
    setEditingProductCode(product.code)
    setSavedProduct(product)
    setUnitForm({ unit: 'Adet', innerQuantity: '', barcode: '' })
    setProductDialogOpen(true)
    setUnitDialogOpen(true)
  }

  return <div className="product-definition-window">
    <div className="definition-tabs" role="tablist">
      {tabs.map((tab) => <button aria-selected={activeTab === tab} className={activeTab === tab ? 'is-selected' : ''} key={tab} onClick={() => setActiveTab(tab)} role="tab" type="button">{tab}</button>)}
    </div>
    {error && <p className="unit-error">{error}</p>}

    {activeTab === tabs[0] && <section className="product-panel">
      <div className="definition-panel-heading"><div><p className="definition-kicker">MERKEZİ ÜRÜN KATALOĞU</p><h2>Ürün Kartları</h2></div>{canCreate && <button className="primary-action" onClick={() => void openNewProduct()} type="button">Yeni</button>}</div>
      <div className="customers-table-wrap"><table className="customers-table product-table"><thead><tr><th>Kod</th><th>Ürün</th><th>Grup</th><th>Tip</th><th>Birim</th><th>KDV</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>{products.map((product) => <tr key={product.code} onDoubleClick={canEdit ? () => openProductEdit(product) : undefined}><td className="customer-code">{product.code}</td><td>{product.name}</td><td>{product.category}</td><td>{product.productType || '-'}</td><td>{product.unit}</td><td>{product.vat}</td><td><span className="status-active">{product.active ? 'Aktif' : 'Pasif'}</span></td><td>{canDelete && <div className="user-row-actions"><button className="delete-action" onClick={() => void removeProduct(product)} type="button">Sil</button></div>}</td></tr>)}</tbody></table></div>
      {productDialogOpen && <div className="product-dialog-backdrop"><section className="product-dialog"><div className="definition-panel-heading"><div><p className="definition-kicker">ÜRÜN KAYDI</p><h2>{editingProductCode ? 'Ürün Düzenle' : 'Yeni Ürün'}</h2></div><button className="dialog-close" onClick={() => setProductDialogOpen(false)} type="button">×</button></div><div className="product-dialog-grid"><label>Ürün Kodu<input disabled value={productForm.code} /></label><label>Ürün Adı<input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></label><label>Ürün Grubu<select value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })}><option value="">Grup seçiniz</option>{groups.map((group) => <option key={group.code} value={group.name}>{group.name}</option>)}</select></label><label>Ürün Tipi<select value={productForm.productType} onChange={(event) => setProductForm({ ...productForm, productType: event.target.value })}><option value="">Tip seçiniz</option>{types.map((type) => <option key={type.code} value={type.name}>{type.name}</option>)}</select></label><label>Varsayılan Birim<select value={productForm.unit} onChange={(event) => setProductForm({ ...productForm, unit: event.target.value })}><option>Koli</option><option>Adet</option><option>Palet</option><option>Kutu</option></select></label><label>KDV Oranı<select value={productForm.vat} onChange={(event) => setProductForm({ ...productForm, vat: event.target.value })}><option>%0</option><option>%1</option><option>%10</option><option>%20</option></select></label><label>E-Puan<input value={productForm.ePoint} onChange={(event) => setProductForm({ ...productForm, ePoint: event.target.value })} /></label><label>Hacim<input value={productForm.volume} onChange={(event) => setProductForm({ ...productForm, volume: event.target.value })} /></label><label>Ağırlık<input value={productForm.weight} onChange={(event) => setProductForm({ ...productForm, weight: event.target.value })} /></label></div><div className="dialog-actions"><button className="primary-action" onClick={() => void saveProduct()} type="button">Kaydet</button></div></section></div>}
    </section>}

    {activeTab === tabs[1] && <section className="product-panel">
      <p className="definition-kicker">FİYAT YÖNETİMİ</p>
      <h2>Ürün Fiyat Tanımlama</h2>
      <input aria-label="Ürün ara" className="price-product-search" onChange={(event) => setProductSearch(event.target.value)} placeholder="Ürün kodu veya adı ara..." value={productSearch} />
      <div className="customers-table-wrap"><table className="customers-table product-table"><thead><tr><th>Kod</th><th>Ürün</th><th>Grup</th><th>Tip</th></tr></thead><tbody>{products.filter((product) => `${product.code} ${product.name}`.toLocaleLowerCase('tr-TR').includes(productSearch.toLocaleLowerCase('tr-TR'))).map((product) => <tr className={selectedPriceProductCode === product.code ? 'is-selected' : ''} key={product.code} onClick={() => setSelectedPriceProductCode(product.code)} onDoubleClick={() => openPriceForm(product)}><td className="customer-code">{product.code}</td><td>{product.name}</td><td>{product.category}</td><td>{product.productType || '-'}</td></tr>)}</tbody></table></div>
      {selectedPriceProductCode && <div className="customers-table-wrap"><table className="customers-table product-table"><thead><tr><th>Ürün</th><th>Başlangıç</th><th>Bitiş</th><th>Alış</th><th>Satış</th><th>Sağlam İade</th><th>Bozuk İade</th><th>Tavsiye Edilen</th><th>İşlemler</th></tr></thead><tbody>{prices.filter((price) => price.productCode === selectedPriceProductCode).map((price) => <tr key={price.id}><td>{price.productCode} · {price.productName}</td><td>{price.startDate}</td><td>{price.endDate}</td><td>{price.purchasePrice}</td><td>{price.salesPrice}</td><td>{price.soundReturnPrice}</td><td>{price.damagedReturnPrice}</td><td>{price.recommendedSalesPrice}</td><td><div className="user-row-actions"><button onClick={() => { const product = products.find((item) => item.code === price.productCode); if (product) openPriceForm(product, price) }} type="button">Düzenle</button><button className="delete-action" onClick={() => void removePrice(price)} type="button">Sil</button></div></td></tr>)}</tbody></table></div>}
      {priceDialogOpen && <div className="product-dialog-backdrop"><section aria-modal="true" className="product-dialog" role="dialog"><div className="definition-panel-heading"><div><p className="definition-kicker">ÜRÜN FİYATI</p><h2>{priceForm.productCode} · {priceForm.productName}</h2></div><button className="dialog-close" onClick={() => setPriceDialogOpen(false)} type="button">×</button></div><div className="product-dialog-grid"><label>Fiyat Başlangıç Tarihi<input type="date" value={priceForm.startDate} onChange={(event) => setPriceForm({ ...priceForm, startDate: event.target.value })} /></label><label>Fiyat Bitiş Tarihi<input type="date" value={priceForm.endDate} onChange={(event) => setPriceForm({ ...priceForm, endDate: event.target.value })} /></label><label>Alış Fiyatı<input inputMode="decimal" value={priceForm.purchasePrice} onChange={(event) => setPriceForm({ ...priceForm, purchasePrice: event.target.value })} /></label><label>Satış Fiyatı<input inputMode="decimal" value={priceForm.salesPrice} onChange={(event) => setPriceForm({ ...priceForm, salesPrice: event.target.value })} /></label><label>Sağlam İade Fiyatı<input inputMode="decimal" value={priceForm.soundReturnPrice} onChange={(event) => setPriceForm({ ...priceForm, soundReturnPrice: event.target.value })} /></label><label>Bozuk İade Fiyatı<input inputMode="decimal" value={priceForm.damagedReturnPrice} onChange={(event) => setPriceForm({ ...priceForm, damagedReturnPrice: event.target.value })} /></label><label>Tavsiye Edilen Satış Fiyatı<input inputMode="decimal" value={priceForm.recommendedSalesPrice} onChange={(event) => setPriceForm({ ...priceForm, recommendedSalesPrice: event.target.value })} /></label><label>Durum<select value={priceForm.status} onChange={(event) => setPriceForm({ ...priceForm, status: event.target.value })}><option>Aktif</option><option>Pasif</option></select></label></div><div className="dialog-actions"><button className="primary-action" onClick={() => void savePrice()} type="button">{editingPriceId ? 'Değişiklikleri Kaydet' : 'Fiyatı Kaydet'}</button></div></section></div>}
    </section>}

    {activeTab === tabs[2] && <section className="product-panel"><p className="definition-kicker">ÜRÜN GRUPLARI</p><h2>Ürün Grup Tanımlama</h2><div className="compact-form-grid group-form"><label>Grup Kodu<input disabled={Boolean(editingGroupCode)} placeholder="Otomatik" value={groupForm.code} onChange={(event) => setGroupForm({ ...groupForm, code: event.target.value })} /></label><label>Grup Adı<input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></label><button className="primary-action" onClick={() => void saveGroup()} type="button">{editingGroupCode ? 'Kaydet' : 'Ekle'}</button></div><div className="customers-table-wrap"><table className="customers-table product-table"><thead><tr><th>Kod</th><th>Grup</th><th>İşlemler</th></tr></thead><tbody>{groups.map((group) => <tr key={group.code}><td>{group.code}</td><td>{group.name}</td><td><div className="user-row-actions"><button onClick={() => { setGroupForm(group); setEditingGroupCode(group.code) }} type="button">Düzenle</button><button className="delete-action" onClick={() => void removeMasterData('productGroups', group)} type="button">Sil</button></div></td></tr>)}</tbody></table></div></section>}

    {activeTab === tabs[3] && <section className="product-panel"><p className="definition-kicker">ÜRÜN TİPLERİ</p><h2>Ürün Tipi Tanımlama</h2><div className="compact-form-grid group-form"><label>Tip Kodu<input disabled={Boolean(editingTypeCode)} placeholder="Otomatik" value={typeForm.code} onChange={(event) => setTypeForm({ ...typeForm, code: event.target.value })} /></label><label>Tip Adı<input value={typeForm.name} onChange={(event) => setTypeForm({ ...typeForm, name: event.target.value })} /></label><button className="primary-action" onClick={() => void saveType()} type="button">{editingTypeCode ? 'Kaydet' : 'Ekle'}</button></div><div className="customers-table-wrap"><table className="customers-table product-table"><thead><tr><th>Kod</th><th>Tip</th><th>İşlemler</th></tr></thead><tbody>{types.map((type) => <tr key={type.code}><td>{type.code}</td><td>{type.name}</td><td><div className="user-row-actions"><button onClick={() => { setTypeForm(type); setEditingTypeCode(type.code) }} type="button">Düzenle</button><button className="delete-action" onClick={() => void removeMasterData('productTypes', type)} type="button">Sil</button></div></td></tr>)}</tbody></table></div></section>}

    {unitDialogOpen && savedProduct && <div className="product-dialog-backdrop">
      <section aria-modal="true" className="product-dialog unit-dialog" role="dialog">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">ÜRÜN BİRİMLERİ</p>
            <h2>{savedProduct.code} · {savedProduct.name}</h2>
          </div>
          <button aria-label="Birim penceresini kapat" className="dialog-close" onClick={() => setUnitDialogOpen(false)} type="button">×</button>
        </div>
        <div className="unit-entry-grid">
          <label>
            Birim
            <select value={unitForm.unit} onChange={(event) => setUnitForm({ ...unitForm, unit: event.target.value })}>
              <option>Adet</option><option>Kutu</option><option>Koli</option><option>Gr</option><option>Kg</option><option>Litre</option>
            </select>
          </label>
          <label>İç Miktar<input inputMode="numeric" value={unitForm.innerQuantity} onChange={(event) => setUnitForm({ ...unitForm, innerQuantity: event.target.value })} placeholder="1 veya 12" /></label>
          <label>Barkod Numarası<input inputMode="numeric" value={unitForm.barcode} onChange={(event) => setUnitForm({ ...unitForm, barcode: event.target.value })} placeholder="Barkod numarası" /></label>
          <button className="primary-action" onClick={() => void addProductUnit()} type="button">Listeye Ekle</button>
        </div>
        <div className="customers-table-wrap unit-table-wrap">
          <table className="customers-table product-table">
            <thead><tr><th>Ürün Kodu</th><th>Ürün</th><th>Birim</th><th>İç Miktar</th><th>Barkod Numarası</th><th>İşlemler</th></tr></thead>
            <tbody>{productUnits.filter((unit) => unit.productCode === savedProduct.code).map((unit) => <tr key={unit.barcode}><td className="customer-code">{savedProduct.code}</td><td>{savedProduct.name}</td><td>{unit.unit}</td><td>{unit.innerQuantity}</td><td>{unit.barcode}</td><td><div className="user-row-actions"><button className="delete-action" onClick={() => void removeProductUnit(unit)} type="button">Sil</button></div></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>}
  </div>
}
