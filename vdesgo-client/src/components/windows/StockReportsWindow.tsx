import { useEffect, useMemo, useState } from 'react'

type StockRow = { warehouseCode: string; warehouseName: string; productCode: string; productName: string; unit: string; category: string; productType: string; baseQuantity: number }
type FilterOption = { value: string; label: string }

function FilterPicker({ label, values, options, active, onOpen, onClose, onChange }: { label: string; values: string[]; options: FilterOption[]; active: boolean; onOpen: () => void; onClose: () => void; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  return <div className="stock-report-filter"><span>{label}</span><button className="stock-report-filter-button" onClick={onOpen} type="button">{values.length ? `${values.length} seçim` : `Tümü (${options.length})`}</button>{active && <div className="stock-report-picker-backdrop" onClick={onClose}><section className="stock-report-picker" onClick={(event) => event.stopPropagation()}><div className="definition-panel-heading"><div><p className="definition-kicker">STOK RAPORU FİLTRESİ</p><h2>{label} seç</h2></div><button className="dialog-close" onClick={onClose} type="button">×</button></div><div className="stock-report-picker-actions"><button className="secondary-action" onClick={() => onChange(options.map((option) => option.value))} type="button">Tümünü seç</button><button className="secondary-action" onClick={() => onChange([])} type="button">Seçimleri kaldır</button></div><div className="stock-report-picker-list">{options.map((option) => <label key={option.value}><input checked={values.includes(option.value)} onChange={() => toggle(option.value)} type="checkbox" /><span>{option.label}</span></label>)}</div><div className="dialog-actions"><button className="primary-action" onClick={onClose} type="button">Seçimleri tamamla</button></div></section></div>}</div>
}

export function StockReportsWindow() {
  const [rows, setRows] = useState<StockRow[]>([])
  const [productFilter, setProductFilter] = useState('')
  const [warehouseFilters, setWarehouseFilters] = useState<string[]>([])
  const [productTypeFilters, setProductTypeFilters] = useState<string[]>([])
  const [productGroupFilters, setProductGroupFilters] = useState<string[]>([])
  const [productNameFilters, setProductNameFilters] = useState<string[]>([])
  const [picker, setPicker] = useState<'warehouse' | 'type' | 'group' | 'product' | null>(null)
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
    fetch(`${apiUrl}/inventory/stock-report`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: StockRow[]) => setRows(data))
      .catch(() => setMessage('Stok raporu alınamadı.'))
  }, [apiUrl, authHeaders])

  const warehouses = Array.from(new Map(rows.map((row) => [row.warehouseCode, row.warehouseName])).entries())
  const productTypes = Array.from(new Set(rows.map((row) => row.productType).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'tr-TR'))
  const productGroups = Array.from(new Set(rows.map((row) => row.category).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'tr-TR'))
  const productNames = Array.from(new Map(rows.map((row) => [row.productCode, `${row.productCode} · ${row.productName}`])).entries())
    .sort((left, right) => left[1].localeCompare(right[1], 'tr-TR'))
  const filteredRows = rows.filter((row) => {
    const query = productFilter.toLocaleLowerCase('tr-TR')
    return (!warehouseFilters.length || warehouseFilters.includes(row.warehouseCode))
      && (!productTypeFilters.length || productTypeFilters.includes(row.productType))
      && (!productGroupFilters.length || productGroupFilters.includes(row.category))
      && (!productNameFilters.length || productNameFilters.includes(row.productCode))
      && (!query || `${row.productCode} ${row.productName}`.toLocaleLowerCase('tr-TR').includes(query))
  })
  const totalQuantity = filteredRows.reduce((total, row) => total + row.baseQuantity, 0)
  const positiveRows = filteredRows.filter((row) => row.baseQuantity !== 0)

  return <div className="stock-reports-window">
    <section className="definition-panel stock-report-panel">
      <div className="definition-panel-heading"><div><p className="definition-kicker">RAPORLAR</p><h2>Stok Raporları</h2></div><span className="mock-badge">{positiveRows.length} SATIR</span></div>
      <div className="stock-report-toolbar"><FilterPicker label="Depo" values={warehouseFilters} options={warehouses.map(([code, name]) => ({ value: code, label: `${name} (${code})` }))} active={picker === 'warehouse'} onOpen={() => setPicker('warehouse')} onClose={() => setPicker(null)} onChange={setWarehouseFilters} /><FilterPicker label="Ürün tipi" values={productTypeFilters} options={productTypes.map((type) => ({ value: type, label: type }))} active={picker === 'type'} onOpen={() => setPicker('type')} onClose={() => setPicker(null)} onChange={setProductTypeFilters} /><FilterPicker label="Ürün grubu" values={productGroupFilters} options={productGroups.map((group) => ({ value: group, label: group }))} active={picker === 'group'} onOpen={() => setPicker('group')} onClose={() => setPicker(null)} onChange={setProductGroupFilters} /><FilterPicker label="Ürün adı" values={productNameFilters} options={productNames.map(([code, name]) => ({ value: code, label: name }))} active={picker === 'product'} onOpen={() => setPicker('product')} onClose={() => setPicker(null)} onChange={setProductNameFilters} /><label>Ürün ara<input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Kod veya ürün adı" /></label></div>
      {message && <p className="unit-error" role="alert">{message}</p>}
      <div className="stock-report-summary"><span>Toplam satır<strong>{positiveRows.length}</strong></span><span>Toplam miktar<strong>{totalQuantity.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</strong></span></div>
      <div className="customers-table-wrap"><table className="customers-table stock-report-table"><thead><tr><th>Depo</th><th>Ürün Kodu</th><th>Ürün</th><th>Ürün Tipi</th><th>Ürün Grubu</th><th>Birim</th><th>Mevcut Miktar</th><th>Durum</th></tr></thead><tbody>{positiveRows.length === 0 ? <tr><td colSpan={8} className="operation-list-empty">Stok kaydı bulunmuyor.</td></tr> : positiveRows.map((row) => <tr key={`${row.warehouseCode}-${row.productCode}`}><td>{row.warehouseName}</td><td className="customer-code">{row.productCode}</td><td>{row.productName}</td><td>{row.productType || '-'}</td><td>{row.category || '-'}</td><td>{row.unit || '-'}</td><td className="stock-report-quantity">{row.baseQuantity.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td><td><span className={row.baseQuantity < 0 ? 'status-inactive' : 'status-active'}>{row.baseQuantity < 0 ? 'Eksi stok' : 'Mevcut'}</span></td></tr>)}</tbody></table></div>
    </section>
  </div>
}
