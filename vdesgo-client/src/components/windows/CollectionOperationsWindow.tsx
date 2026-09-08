import { useEffect, useMemo, useState } from 'react'
import { useWindowStore } from '../../stores/useWindowStore'

type CollectionType = 'Tahsilat' | 'Bakiye Düşürme' | 'Bakiye Yükseltme'
type CollectionRecord = { id: number; operationType: CollectionType; operationDate: string; customerCode: string; customerName: string; customerTitle: string; amount: number; description: string }
const types: CollectionType[] = ['Tahsilat', 'Bakiye Düşürme', 'Bakiye Yükseltme']

export function CollectionOperationsWindow() {
  const [activeType, setActiveType] = useState<CollectionType>('Tahsilat')
  const [records, setRecords] = useState<CollectionRecord[]>([])
  const [filter, setFilter] = useState('')
  const openWindow = useWindowStore((state) => state.openWindow)
  const maximizeWindow = useWindowStore((state) => state.maximizeWindow)
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders: Record<string, string> = (() => { try { const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}'); return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' } } catch { return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' } } })()

  useEffect(() => {
    fetch(`${apiUrl}/collection-operations`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()).then((data: CollectionRecord[]) => setRecords(data)).catch(() => setRecords([]))
    const handler = (event: Event) => { const record = (event as CustomEvent<{ record: CollectionRecord }>).detail?.record; if (record) setRecords((current) => [record, ...current]) }
    window.addEventListener('vdesgo:collection-saved', handler)
    return () => window.removeEventListener('vdesgo:collection-saved', handler)
  }, [apiUrl])

  const visibleRecords = useMemo(() => records.filter((record) => record.operationType === activeType && (!filter || `${record.customerCode} ${record.customerName} ${record.customerTitle}`.toLocaleLowerCase('tr-TR').includes(filter.toLocaleLowerCase('tr-TR')))), [activeType, filter, records])
  const openNew = () => { const windowId = openWindow({ moduleName: 'CollectionEntry', title: `Yeni ${activeType}`, collectionType: activeType, instanceType: 'MULTIPLE', x: 120, y: 110, width: 620, height: 390 }); maximizeWindow(windowId) }

  return <div className="collection-operations-window"><aside className="collection-side-menu"><p className="definition-kicker">TAHSİLAT İŞLEMLERİ</p>{types.map((type) => <button className={activeType === type ? 'is-selected' : ''} key={type} onClick={() => setActiveType(type)} type="button">{type}</button>)}</aside><section className="collection-list-content"><div className="customers-toolbar"><div><strong>{activeType} Listesi</strong><span>{visibleRecords.length} kayıt</span></div><button className="primary-action" onClick={openNew} type="button">Yeni</button></div><input className="collection-filter" placeholder="Cari ara..." value={filter} onChange={(event) => setFilter(event.target.value)} /><div className="customers-table-wrap"><table className="customers-table"><thead><tr><th>Tarih</th><th>Cari</th><th>Tutar</th><th>Açıklama</th></tr></thead><tbody>{visibleRecords.length === 0 ? <tr><td colSpan={4} className="operation-list-empty">Kayıt bulunmuyor.</td></tr> : visibleRecords.map((record) => <tr key={record.id}><td>{record.operationDate}</td><td>{record.customerCode} · {record.customerName} · {record.customerTitle}</td><td>{Number(record.amount).toFixed(2).replace('.', ',')} TL</td><td>{record.description}</td></tr>)}</tbody></table></div></section></div>
}
