import { useEffect, useState } from 'react'

type OperationTab = 'Sair Giriş' | 'Sair Çıkış' | 'Depolar Arası Transfer' | 'Araç Yükleme' | 'Sayım İşlemleri'
type EntryLine = { productCode: string; productName: string; unit: string; innerQuantity?: string; quantity: string | number; totalQuantity: string | number }
type Entry = { id: number; receiptNo: number; entryDate: string; operationDate?: string; enteringWarehouseCode: string; enteringWarehouseName: string; exitingWarehouseCode?: string; exitingWarehouseName?: string; tenantCode: string | null; lineCount?: number; totalQuantity?: number; lines: EntryLine[] }
type RecordItem = { id: number; receiptNo: number; operationDate: string; enteringWarehouseCode?: string; enteringWarehouseName?: string; exitingWarehouseCode?: string; exitingWarehouseName?: string; tenantCode: string | null; lineCount: number; totalQuantity: number; lines?: EntryLine[] }

const tabs: OperationTab[] = ['Sair Giriş', 'Sair Çıkış', 'Depolar Arası Transfer', 'Araç Yükleme', 'Sayım İşlemleri']

export function WarehouseOperationsListWindow() {
  const [activeTab, setActiveTab] = useState<OperationTab>('Sair Giriş')
  const [entries, setEntries] = useState<Entry[]>([])
  const [exits, setExits] = useState<RecordItem[]>([])
  const [transfers, setTransfers] = useState<RecordItem[]>([])
  const [vehicleLoadings, setVehicleLoadings] = useState<RecordItem[]>([])
  const [selected, setSelected] = useState<{ title: string; record: Entry | RecordItem } | null>(null)
  const [message, setMessage] = useState('')
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders = (() => { try { const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}'); return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' } } catch { return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' } } })()

  const loadRecords = () => {
    Promise.all([
      fetch(`${apiUrl}/inventory/other-entries`, { headers: authHeaders }).then((r) => r.ok ? r.json() : Promise.reject()),
      fetch(`${apiUrl}/inventory/operation-records/other-exits`, { headers: authHeaders }).then((r) => r.ok ? r.json() : Promise.reject()),
      fetch(`${apiUrl}/inventory/operation-records/transfers`, { headers: authHeaders }).then((r) => r.ok ? r.json() : Promise.reject()),
      fetch(`${apiUrl}/inventory/operation-records/vehicle-loadings`, { headers: authHeaders }).then((r) => r.ok ? r.json() : Promise.reject()),
    ]).then(([entryData, exitData, transferData, loadingData]) => { setEntries(entryData); setExits(exitData); setTransfers(transferData); setVehicleLoadings(loadingData) }).catch(() => setMessage('İşlem kayıtları alınamadı.'))
  }

  useEffect(() => { loadRecords() }, [apiUrl])

  const removeRecord = async (operation: string, id: number) => {
    if (!window.confirm('Bu işlem kaydını silmek istediğinize emin misiniz?')) return
    const response = await fetch(`${apiUrl}/inventory/operation-records/${operation}/${id}`, { method: 'DELETE', headers: authHeaders })
    if (!response.ok) return setMessage('İşlem kaydı silinemedi.')
    loadRecords()
  }

  const operationTable = (records: RecordItem[], title: string, operation: string, transfer = false) => (
    <section className="definition-panel operation-list-panel"><div className="definition-panel-heading"><div><p className="definition-kicker">KAYITLI İŞLEMLER</p><h2>{title}</h2></div><span className="mock-badge">{records.length} FİŞ</span></div><div className="customers-table-wrap operation-list-table-wrap"><table className="customers-table"><thead><tr><th>Fiş No</th><th>Tarih</th><th>Çıkan Depo</th>{transfer && <th>Giren Depo</th>}{!transfer && <th>Giren Depo</th>}<th>Distribütör</th><th>Ürün Sayısı</th><th>Toplam Miktar</th><th>İşlem</th></tr></thead><tbody>{records.length === 0 ? <tr><td colSpan={transfer ? 8 : 8} className="operation-list-empty">Kayıt bulunmuyor.</td></tr> : records.map((record) => <tr key={record.id} onClick={() => setSelected({ title: `${title} Detayı`, record })}><td className="customer-code">{record.receiptNo}</td><td>{record.operationDate}</td><td>{record.exitingWarehouseName || record.exitingWarehouseCode || '-'}</td><td>{record.enteringWarehouseName || record.enteringWarehouseCode || '-'}</td><td>{record.tenantCode || 'Merkez'}</td><td>{record.lineCount}</td><td>{record.totalQuantity}</td><td><button className="danger-button" onClick={(event) => { event.stopPropagation(); void removeRecord(operation, record.id) }} type="button">Sil</button></td></tr>)}</tbody></table></div></section>
  )

  return <div className="warehouse-operations-list-window">
    <div className="definition-tabs" role="tablist" aria-label="Depo işlemleri kayıt sekmeleri">{tabs.map((tab) => <button aria-selected={activeTab === tab} className={activeTab === tab ? 'is-selected' : ''} key={tab} onClick={() => setActiveTab(tab)} role="tab" type="button">{tab}</button>)}</div>
    {message && <p className="unit-error" role="alert">{message}</p>}
    {activeTab === 'Sair Giriş' && <section className="definition-panel operation-list-panel"><div className="definition-panel-heading"><div><p className="definition-kicker">KAYITLI İŞLEMLER</p><h2>Sair Giriş Listesi</h2></div><span className="mock-badge">{entries.length} FİŞ</span></div><div className="customers-table-wrap operation-list-table-wrap"><table className="customers-table"><thead><tr><th>Fiş No</th><th>Tarih</th><th>Giren Depo</th><th>Distribütör</th><th>Ürün Sayısı</th><th>Toplam Miktar</th><th>İşlem</th></tr></thead><tbody>{entries.length === 0 ? <tr><td colSpan={7} className="operation-list-empty">Kayıt bulunmuyor.</td></tr> : entries.map((entry) => <tr key={entry.id} onClick={() => setSelected({ title: 'Sair Giriş Detayı', record: entry })}><td className="customer-code">{entry.receiptNo}</td><td>{entry.entryDate}</td><td>{entry.enteringWarehouseName || entry.enteringWarehouseCode}</td><td>{entry.tenantCode || 'Merkez'}</td><td>{entry.lines.length}</td><td>{entry.lines.reduce((total, line) => total + Number(line.totalQuantity), 0)}</td><td><button className="danger-button" onClick={(event) => { event.stopPropagation(); void removeRecord('other-entries', entry.id) }} type="button">Sil</button></td></tr>)}</tbody></table></div></section>}
    {activeTab === 'Sair Çıkış' && operationTable(exits, 'Sair Çıkış Listesi', 'other-exits')}
    {activeTab === 'Depolar Arası Transfer' && operationTable(transfers, 'Depolar Arası Transfer Listesi', 'transfers', true)}
    {activeTab === 'Araç Yükleme' && operationTable(vehicleLoadings, 'Araç Yükleme Listesi', 'vehicle-loadings', true)}
    {activeTab === 'Sayım İşlemleri' && <section className="definition-panel operation-list-panel"><p className="definition-kicker">KAYITLI İŞLEMLER</p><h2>Sayım İşlemleri</h2><p>Bu işlem türüne ait kayıt bulunmuyor.</p></section>}
    {selected && <div className="operation-detail-backdrop" onClick={() => setSelected(null)}><section className="operation-detail-dialog" onClick={(event) => event.stopPropagation()}><div className="definition-panel-heading"><div><p className="definition-kicker">İŞLEM DETAYI</p><h2>{selected.title}</h2></div><div className="operation-detail-actions"><button className="primary-action" onClick={() => window.print()} type="button">Yazdır</button><button className="ghost-button" onClick={() => setSelected(null)} type="button">Kapat</button></div></div><div className="operation-detail-grid"><span>Fiş No<strong>{selected.record.receiptNo}</strong></span><span>Tarih<strong>{'entryDate' in selected.record ? selected.record.entryDate : selected.record.operationDate}</strong></span><span>Giren Depo<strong>{'enteringWarehouseName' in selected.record ? selected.record.enteringWarehouseName || selected.record.enteringWarehouseCode || '-' : '-'}</strong></span><span>Çıkan Depo<strong>{'exitingWarehouseName' in selected.record ? selected.record.exitingWarehouseName || selected.record.exitingWarehouseCode || '-' : '-'}</strong></span><span>Distribütör<strong>{selected.record.tenantCode || 'Merkez'}</strong></span><span>Ürün / Satır<strong>{'lines' in selected.record && selected.record.lines ? selected.record.lines.length : selected.record.lineCount}</strong></span><span>Toplam Miktar<strong>{'lines' in selected.record && selected.record.lines ? selected.record.lines.reduce((total, line) => total + Number(line.totalQuantity), 0) : selected.record.totalQuantity}</strong></span></div>{'lines' in selected.record && selected.record.lines && selected.record.lines.length > 0 && <div className="customers-table-wrap operation-detail-lines"><table className="customers-table"><thead><tr><th>Ürün Kodu</th><th>Ürün</th><th>Birim</th><th>Birim İçeriği</th><th>Miktar</th><th>Toplam</th></tr></thead><tbody>{selected.record.lines.map((line, index) => <tr key={`${line.productCode}-${index}`}><td>{line.productCode}</td><td>{line.productName}</td><td>{line.unit}</td><td>{line.innerQuantity}</td><td>{line.quantity}</td><td>{line.totalQuantity}</td></tr>)}</tbody></table></div>}</section></div>}
  </div>
}
