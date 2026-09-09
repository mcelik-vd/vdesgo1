import { useEffect, useMemo, useState } from 'react'

type Option = { code: string; name: string }
type TransferRow = { id: number; receiptNo: number; transferDate: string; enteringWarehouseCode: string; enteringWarehouseName: string; exitingWarehouseCode: string; exitingWarehouseName: string; productCode: string; productName: string; unit: string; innerQuantity: number; quantity: number; totalQuantity: number }

export function WarehouseTransferReportsWindow() {
  const [rows, setRows] = useState<TransferRow[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [products, setProducts] = useState<Option[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [enteringWarehouse, setEnteringWarehouse] = useState('')
  const [exitingWarehouse, setExitingWarehouse] = useState('')
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [message, setMessage] = useState('')
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders = useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}')
      return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' }
    } catch {
      return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' }
    }
  }, [])

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/data/warehouses`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/products`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([warehouseData, productData]) => {
      setWarehouses(warehouseData.filter((item: Option & { active?: boolean }) => item.active !== false))
      setProducts(productData.filter((item: Option & { active?: boolean }) => item.active !== false))
    }).catch(() => setMessage('Depo ve ürün listeleri alınamadı.'))
  }, [apiUrl, authHeaders])

  const loadReport = async () => {
    if (startDate && endDate && startDate > endDate) {
      setMessage('Başlangıç tarihi bitiş tarihinden sonra olamaz.')
      return
    }
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (enteringWarehouse) params.set('enteringWarehouseCode', enteringWarehouse)
    if (exitingWarehouse) params.set('exitingWarehouseCode', exitingWarehouse)
    selectedProducts.forEach((code) => params.append('productCode', code))
    try {
      const response = await fetch(`${apiUrl}/inventory/warehouse-transfer-report?${params.toString()}`, { headers: authHeaders })
      if (!response.ok) throw new Error()
      setRows(await response.json() as TransferRow[])
      setMessage('')
    } catch {
      setMessage('Depolar arası stok hareketleri raporu alınamadı.')
    }
  }

  useEffect(() => { void loadReport() }, [apiUrl, authHeaders])

  const toggleProduct = (code: string) => setSelectedProducts((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code])
  const totalQuantity = rows.reduce((total, row) => total + Number(row.totalQuantity), 0)

  return <div className="warehouse-transfer-reports-window">
    <section className="definition-panel stock-report-panel">
      <div className="definition-panel-heading"><div><p className="definition-kicker">RAPORLAR</p><h2>Depolar Arası Stok Hareketleri</h2></div><span className="mock-badge">{rows.length} SATIR</span></div>
      <div className="warehouse-transfer-report-filters"><label>Başlangıç tarihi<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Bitiş tarihi<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label>Giren depo<select value={enteringWarehouse} onChange={(event) => setEnteringWarehouse(event.target.value)}><option value="">Tümü</option>{warehouses.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}</select></label><label>Çıkan depo<select value={exitingWarehouse} onChange={(event) => setExitingWarehouse(event.target.value)}><option value="">Tümü</option>{warehouses.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}</select></label><div className="warehouse-transfer-product-filter"><span>Ürünler</span><button className="stock-report-filter-button" onClick={() => setProductPickerOpen(true)} type="button">{selectedProducts.length ? `${selectedProducts.length} seçim` : `Tümü (${products.length})`}</button></div><button className="primary-action warehouse-transfer-report-search" onClick={() => void loadReport()} type="button">Raporla</button></div>
      {message && <p className="unit-error" role="alert">{message}</p>}
      <div className="stock-report-summary"><span>Toplam satır<strong>{rows.length}</strong></span><span>Toplam miktar<strong>{totalQuantity.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</strong></span></div>
      <div className="customers-table-wrap"><table className="customers-table warehouse-transfer-report-table"><thead><tr><th>Fiş No</th><th>Tarih</th><th>Giren Depo</th><th>Çıkan Depo</th><th>Ürün Kodu</th><th>Ürün</th><th>Birim</th><th>Miktar</th><th>Toplam</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={9} className="operation-list-empty">Kayıt bulunmuyor.</td></tr> : rows.map((row, index) => <tr key={`${row.id}-${row.productCode}-${index}`}><td>{row.receiptNo}</td><td>{row.transferDate}</td><td>{row.enteringWarehouseName || row.enteringWarehouseCode}</td><td>{row.exitingWarehouseName || row.exitingWarehouseCode}</td><td className="customer-code">{row.productCode}</td><td>{row.productName}</td><td>{row.unit}</td><td>{row.quantity}</td><td className="stock-report-quantity">{row.totalQuantity}</td></tr>)}</tbody></table></div>
    </section>
    {productPickerOpen && <div className="stock-report-picker-backdrop" onClick={() => setProductPickerOpen(false)}><section className="stock-report-picker" onClick={(event) => event.stopPropagation()}><div className="definition-panel-heading"><div><p className="definition-kicker">ÜRÜN FİLTRESİ</p><h2>Ürün seç</h2></div><button className="dialog-close" onClick={() => setProductPickerOpen(false)} type="button">×</button></div><div className="stock-report-picker-actions"><button className="secondary-action" onClick={() => setSelectedProducts(products.map((item) => item.code))} type="button">Tümünü seç</button><button className="secondary-action" onClick={() => setSelectedProducts([])} type="button">Seçimleri kaldır</button></div><div className="stock-report-picker-list">{products.map((product) => <label key={product.code}><input checked={selectedProducts.includes(product.code)} onChange={() => toggleProduct(product.code)} type="checkbox" /><span><strong>{product.code}</strong> {product.name}</span></label>)}</div><div className="dialog-actions"><button className="primary-action" onClick={() => setProductPickerOpen(false)} type="button">Seçimleri tamamla</button></div></section></div>}
  </div>
}
