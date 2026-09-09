import { useEffect, useState } from 'react'
import { ProductCodePicker } from '../ProductCodePicker'

type Product = { code: string; name: string; active: boolean }
type ProductUnit = { productCode: string; unit: string; innerQuantity: string; barcode: string }
type Warehouse = { code: string; name: string; active: boolean }
type TransferLine = { productCode: string; productName: string; unit: string; innerQuantity: string; quantity: string; totalQuantity: string }

const emptyLine = (): TransferLine => ({ productCode: '', productName: '', unit: '', innerQuantity: '', quantity: '', totalQuantity: '' })
const getInnerQuantityNumber = (value: string) => Number.parseFloat(value.replace(',', '.'))
const operationToday = new Date()
const maxOperationDate = operationToday.toISOString().slice(0, 10)
const minOperationDate = new Date(operationToday.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

export function WarehouseTransferWindow({ onSaved }: { onSaved?: () => void }) {
  const [receiptNo, setReceiptNo] = useState<number | null>(null)
  const [transferDate, setTransferDate] = useState(maxOperationDate)
  const [enteringWarehouseCode, setEnteringWarehouseCode] = useState('')
  const [exitingWarehouseCode, setExitingWarehouseCode] = useState('')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [units, setUnits] = useState<ProductUnit[]>([])
  const [line, setLine] = useState<TransferLine>(emptyLine())
  const [lines, setLines] = useState<TransferLine[]>([])
  const [stockBaseQuantity, setStockBaseQuantity] = useState<number | null>(null)
  const [enteringStockBaseQuantity, setEnteringStockBaseQuantity] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders: Record<string, string> = (() => { try { const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}'); return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' } } catch { return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' } } })()

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/inventory/transfers/next-number`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/warehouses`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/products`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/productUnits`).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([numberData, warehouseData, productData, unitData]) => {
      setReceiptNo(numberData.receiptNo)
      setWarehouses(warehouseData.filter((warehouse: Warehouse) => warehouse.active))
      setProducts(productData.filter((product: Product) => product.active))
      setUnits(unitData)
    }).catch(() => setMessage('Transfer bilgileri alınamadı.'))
  }, [apiUrl])

  const findProduct = (selectedProduct?: Product | unknown) => {
    if (enteringWarehouseCode && exitingWarehouseCode && enteringWarehouseCode === exitingWarehouseCode) {
      window.alert('Giren depo ve çıkan depo aynı olamaz.')
      return
    }
    const product = selectedProduct && typeof selectedProduct === 'object' && 'code' in selectedProduct
      ? selectedProduct as Product
      : products.find((item) => item.code.toLocaleLowerCase('tr-TR') === line.productCode.trim().toLocaleLowerCase('tr-TR'))
    if (!product) { setLine((current) => ({ ...current, productName: '', unit: '', innerQuantity: '' })); setMessage('Ürün kodu bulunamadı.'); return }
    const firstUnit = units.find((item) => item.productCode === product.code)
    setLine((current) => ({ ...current, productCode: product.code, productName: product.name, unit: firstUnit?.unit || '', innerQuantity: firstUnit?.innerQuantity || '' }))
    setMessage('')
  }

  const productUnits = units.filter((item) => item.productCode === line.productCode)
  const selectedUnitContent = getInnerQuantityNumber(line.innerQuantity)
  const stockInSelectedUnit = stockBaseQuantity === null || !Number.isFinite(selectedUnitContent) || selectedUnitContent <= 0 ? null : stockBaseQuantity / selectedUnitContent
  const enteringStockInSelectedUnit = enteringStockBaseQuantity === null || !Number.isFinite(selectedUnitContent) || selectedUnitContent <= 0 ? null : enteringStockBaseQuantity / selectedUnitContent

  useEffect(() => {
    if (!line.productCode) { setStockBaseQuantity(null); setEnteringStockBaseQuantity(null); return }
    if (exitingWarehouseCode) fetch(`${apiUrl}/inventory/stock?warehouseCode=${encodeURIComponent(exitingWarehouseCode)}&productCode=${encodeURIComponent(line.productCode)}`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()).then((stock: { baseQuantity: number }) => setStockBaseQuantity(stock.baseQuantity)).catch(() => setStockBaseQuantity(null))
    else setStockBaseQuantity(null)
    if (enteringWarehouseCode) fetch(`${apiUrl}/inventory/stock?warehouseCode=${encodeURIComponent(enteringWarehouseCode)}&productCode=${encodeURIComponent(line.productCode)}`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()).then((stock: { baseQuantity: number }) => setEnteringStockBaseQuantity(stock.baseQuantity)).catch(() => setEnteringStockBaseQuantity(null))
    else setEnteringStockBaseQuantity(null)
  }, [apiUrl, enteringWarehouseCode, exitingWarehouseCode, line.productCode])

  const addLine = () => {
    if (!enteringWarehouseCode || !exitingWarehouseCode) { window.alert('Lütfen giren ve çıkan depoları seçiniz.'); return }
    if (enteringWarehouseCode === exitingWarehouseCode) { window.alert('Giren depo ve çıkan depo aynı olamaz.'); return }
    const totalQuantity = selectedUnitContent * Number(line.quantity)
    if (!line.productName || !line.unit) return setMessage('Geçerli ürün ve birim seçiniz.')
    if (!line.quantity || Number(line.quantity) <= 0 || !Number.isFinite(totalQuantity)) return setMessage('Miktar sıfırdan büyük olmalıdır.')
    if (stockBaseQuantity !== null && totalQuantity > stockBaseQuantity) return setMessage('Çıkan depoda yeterli stok bulunmuyor.')
    setLines((current) => [...current, { ...line, totalQuantity: String(totalQuantity) }])
    setLine(emptyLine()); setMessage('')
  }

  const removeLine = (index: number) => setLines((current) => current.filter((_, currentIndex) => currentIndex !== index))

  const saveTransfer = async () => {
    if (!receiptNo || !enteringWarehouseCode || !exitingWarehouseCode || enteringWarehouseCode === exitingWarehouseCode || lines.length === 0) { window.alert('Fiş no, farklı iki depo ve en az bir ürün satırı zorunludur.'); return }
    const response = await fetch(`${apiUrl}/inventory/transfers`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ receiptNo, transferDate, enteringWarehouseCode, exitingWarehouseCode, lines }) })
    if (!response.ok) { const error = await response.json().catch(() => ({})) as { error?: string }; setMessage(error.error || 'Transfer kaydedilemedi.'); return }
    setMessage(`Transfer fişi ${receiptNo} kaydedildi.`); setReceiptNo((current) => current ? current + 1 : current); setLines([]); setLine(emptyLine()); setStockBaseQuantity(null); setEnteringStockBaseQuantity(null); onSaved?.()
  }

  return <div className="other-stock-entry-window">
    <section className="shipment-form-panel"><div className="definition-panel-heading"><div><p className="definition-kicker">DEPO İŞLEMLERİ</p><h2>Depolar Arası Transfer</h2></div><span className="mock-badge">FİŞ KAYDI</span></div>
      <div className="shipment-form-grid"><label>Fiş No<input value={receiptNo ?? 'Alınıyor...'} readOnly /></label><label>Tarih<input max={maxOperationDate} min={minOperationDate} type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} /></label><label>Giren Depo<select value={enteringWarehouseCode} onChange={(event) => setEnteringWarehouseCode(event.target.value)}><option value="">Depo seçiniz</option>{warehouses.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name} ({warehouse.code})</option>)}</select></label><label>Çıkan Depo<select value={exitingWarehouseCode} onChange={(event) => setExitingWarehouseCode(event.target.value)}><option value="">Depo seçiniz</option>{warehouses.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name} ({warehouse.code})</option>)}</select></label></div>
    </section>
    <section className="shipment-form-panel"><div className="definition-panel-heading"><div><p className="definition-kicker">ÜRÜN SEÇİMİ</p><h2>Transfer Ürünü</h2></div><ProductCodePicker products={products} value={line.productCode} onChange={(value) => setLine({ ...line, productCode: value })} onSelect={(product) => findProduct(product)} /></div>
      <div className="shipment-form-grid"><label>Ürün Kodu<input autoComplete="off" value={line.productCode} onBlur={findProduct} onChange={(event) => setLine({ ...line, productCode: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Tab') findProduct() }} placeholder="Ürün kodu yazınız" /></label><label>Ürün Adı<input value={line.productName} readOnly /></label><label>Birim<select value={line.unit} onChange={(event) => { const selected = productUnits.find((item) => item.unit === event.target.value); setLine({ ...line, unit: event.target.value, innerQuantity: selected?.innerQuantity || '' }) }}><option value="">Birim seçiniz</option>{productUnits.map((item) => <option key={`${item.productCode}-${item.barcode}`} value={item.unit}>{item.unit}</option>)}</select></label><label>Birim İçeriği<div className="entry-info-value">{line.innerQuantity || '-'}</div></label><label>Miktar<input inputMode="decimal" min="0" type="number" value={line.quantity} onChange={(event) => setLine({ ...line, quantity: event.target.value })} placeholder="Kaç birim?" /></label><label>Toplam Miktar<div className="entry-info-value entry-total-value">{line.quantity && line.innerQuantity ? (selectedUnitContent * Number(line.quantity) || '-') : '-'}</div></label><label>Çıkan Depo Mevcut Stok<div className="entry-info-value entry-stock-value">{stockInSelectedUnit === null ? '-' : `${stockInSelectedUnit} ${line.unit}`}</div></label><label>Giren Depo Mevcut Stok<div className="entry-info-value entry-stock-value">{enteringStockInSelectedUnit === null ? '-' : `${enteringStockInSelectedUnit} ${line.unit}`}</div></label><button className="primary-action other-stock-entry-add" onClick={addLine} type="button">Ekle</button></div>{message && <p className="unit-error" role="alert">{message}</p>}</section>
    <section className="shipment-list-panel"><div className="customers-toolbar"><div><strong>Transfer Ürünleri</strong><span>{lines.length} satır</span></div><button className="primary-action" disabled={lines.length === 0} onClick={() => void saveTransfer()} type="button">Transferi Kaydet</button></div><div className="customers-table-wrap"><table className="customers-table"><thead><tr><th>Ürün Kodu</th><th>Ürün Adı</th><th>Birim</th><th>Birim İçeriği</th><th>Miktar</th><th>Toplam Miktar</th><th>İşlem</th></tr></thead><tbody>{lines.map((item, index) => <tr key={`${item.productCode}-${index}`}><td className="customer-code">{item.productCode}</td><td>{item.productName}</td><td>{item.unit}</td><td>{item.innerQuantity}</td><td>{item.quantity}</td><td>{item.totalQuantity}</td><td><button className="danger-button" onClick={() => removeLine(index)} type="button">Sil</button></td></tr>)}</tbody></table></div></section>
  </div>
}
