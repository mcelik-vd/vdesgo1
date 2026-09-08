import { useEffect, useState } from 'react'

type SalesRepresentative = {
  id: number
  name: string
  phone: string
  routeRegion: string
  vehicleWarehouseCode: string
  orderWarehouseCode: string
  salesType: string
  note: string
  vehiclePlate: string
  active: boolean
}

type Warehouse = { code: string; name: string }
type Vehicle = { plate: string; brandModel: string; vehicleType: string }

const emptyForm = () => ({
  name: '',
  phone: '',
  routeRegion: '',
  vehicleWarehouseCode: '',
  orderWarehouseCode: '',
  salesType: 'Sıcak Satış',
  note: '',
  vehiclePlate: '',
  active: true,
})

export function SalesRepresentativeWindow() {
  const [representatives, setRepresentatives] = useState<SalesRepresentative[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders = (() => {
    try {
      const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}')
      return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' }
    } catch {
      return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' }
    }
  })()

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/data/salesRepresentatives`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/warehouses`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/vehicles`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
    ])
      .then(([representativeData, warehouseData, vehicleData]) => {
        setRepresentatives(representativeData)
        setWarehouses(warehouseData)
        setVehicles(vehicleData)
        setForm((current) => ({
          ...current,
          vehicleWarehouseCode: current.vehicleWarehouseCode || warehouseData[0]?.code || '',
          orderWarehouseCode: current.orderWarehouseCode || warehouseData[0]?.code || '',
          vehiclePlate: current.vehiclePlate || vehicleData[0]?.plate || '',
        }))
      })
      .catch(() => window.alert('Satış temsilcisi tanımları veritabanından alınamadı.'))
  }, [apiUrl])

  const closeForm = () => {
    setForm(emptyForm())
    setEditingId(null)
    setShowForm(false)
  }

  const save = async () => {
    const missingFields = [
      !form.name.trim() && 'Temsilci adı',
      !form.routeRegion.trim() && 'Rota bölgesi',
      !form.vehicleWarehouseCode && 'Araç deposu',
      !form.orderWarehouseCode && 'Sipariş deposu',
      !form.vehiclePlate && 'Sevkiyat aracı',
    ].filter(Boolean)

    if (missingFields.length > 0) {
      window.alert(`Eksik alanlar: ${missingFields.join(', ')}`)
      return
    }

    const response = await fetch(`${apiUrl}/data/salesRepresentatives${editingId ? `/${editingId}` : ''}`, {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ ...form, name: form.name.trim(), phone: form.phone.trim(), routeRegion: form.routeRegion.trim(), note: form.note.trim() }),
    })
    if (!response.ok) return window.alert('Satış temsilcisi kaydedilemedi.')

    const saved = await response.json() as SalesRepresentative
    setRepresentatives((current) => editingId ? current.map((representative) => representative.id === editingId ? saved : representative) : [...current, saved])
    closeForm()
  }

  const edit = (representative: SalesRepresentative) => {
    setForm({ ...representative })
    setEditingId(representative.id)
    setShowForm(true)
  }

  const remove = async (representative: SalesRepresentative) => {
    if (!window.confirm(`${representative.name} satış temsilcisini silmek istediğinize emin misiniz?`)) return
    const response = await fetch(`${apiUrl}/data/salesRepresentatives/${representative.id}`, { method: 'DELETE', headers: authHeaders })
    if (!response.ok) return window.alert('Satış temsilcisi silinemedi.')
    setRepresentatives((current) => current.filter((item) => item.id !== representative.id))
  }

  const warehouseName = (code: string) => warehouses.find((warehouse) => warehouse.code === code)?.name || '-'

  return (
    <div className="sales-representative-window">
      {showForm && <section className="shipment-form-panel">
        <div className="definition-panel-heading"><div><p className="definition-kicker">SATIŞ TEMSİLCİSİ</p><h2>{editingId ? 'Satış Temsilcisi Düzenle' : 'Yeni Satış Temsilcisi'}</h2></div><button className="ghost-button" onClick={closeForm} type="button">Kapat</button></div>
        <div className="shipment-form-grid">
          <label>Temsilci Adı<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ad Soyad" /></label>
          <label>Telefon<input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="05XX XXX XX XX" /></label>
          <label>Rota Bölgesi<input value={form.routeRegion} onChange={(event) => setForm({ ...form, routeRegion: event.target.value })} placeholder="Örn. Burdur Merkez" /></label>
          <label>Araç Deposu<select value={form.vehicleWarehouseCode} onChange={(event) => setForm({ ...form, vehicleWarehouseCode: event.target.value })}><option value="">Depo seçiniz</option>{warehouses.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <label>Sipariş Deposu<select value={form.orderWarehouseCode} onChange={(event) => setForm({ ...form, orderWarehouseCode: event.target.value })}><option value="">Depo seçiniz</option>{warehouses.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <label>Satış Tipi<select value={form.salesType} onChange={(event) => setForm({ ...form, salesType: event.target.value })}><option>Sıcak Satış</option><option>Soğuk Satış</option></select></label>
          <label>Sevkiyat Aracı<select value={form.vehiclePlate} onChange={(event) => setForm({ ...form, vehiclePlate: event.target.value })}><option value="">Araç seçiniz</option>{vehicles.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {vehicle.brandModel || vehicle.vehicleType}</option>)}</select></label>
          <label>Durum<select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Aktif</option><option value="false">Pasif</option></select></label>
          <label className="shipment-form-wide">Özel Not<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Rota, müşteri veya operasyon notu" rows={3} /></label>
        </div>
        <button className="primary-action" onClick={save} type="button">{editingId ? 'Değişiklikleri Kaydet' : 'Temsilciyi Kaydet'}</button>
      </section>}

      <section className="shipment-list-panel">
        <div className="customers-toolbar"><div><strong>Satış Temsilcileri</strong><span>{representatives.length} kayıt</span></div><button className="primary-action" onClick={() => showForm ? closeForm() : setShowForm(true)} type="button">{showForm ? 'Formu Kapat' : 'Yeni'}</button></div>
        <div className="customers-table-wrap"><table className="customers-table sales-representative-table"><thead><tr><th>Temsilci</th><th>Telefon</th><th>Rota Bölgesi</th><th>Araç Deposu</th><th>Sipariş Deposu</th><th>Satış Tipi</th><th>Sevkiyat Aracı</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>{representatives.map((representative) => <tr key={representative.id}><td>{representative.name}</td><td>{representative.phone || '-'}</td><td>{representative.routeRegion}</td><td>{warehouseName(representative.vehicleWarehouseCode)}</td><td>{warehouseName(representative.orderWarehouseCode)}</td><td>{representative.salesType}</td><td>{representative.vehiclePlate}</td><td><span className={representative.active ? 'status-active' : 'status-inactive'}>{representative.active ? 'Aktif' : 'Pasif'}</span></td><td><div className="user-row-actions"><button onClick={() => edit(representative)} type="button">Düzenle</button><button className="delete-action" onClick={() => remove(representative)} type="button">Sil</button></div></td></tr>)}</tbody></table></div>
      </section>
    </div>
  )
}
