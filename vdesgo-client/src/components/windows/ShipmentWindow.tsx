import { useEffect, useState } from 'react'

type Vehicle = {
  plate: string
  licenseNumber: string
  vehicleType: string
  brandModel: string
  modelYear: string
  capacity: string
  insuranceStartDate: string
  insuranceEndDate: string
  cascoStartDate: string
  cascoEndDate: string
  lastOilMaintenanceKm: string
  lastOilMaintenanceDate: string
  tireChangeDate: string
  tireChangeKm: string
  inspectionDueDate: string
  driverName: string
  active: boolean
}

const emptyVehicle = (): Vehicle => ({
  plate: '',
  licenseNumber: '',
  vehicleType: 'Kamyonet',
  brandModel: '',
  modelYear: '',
  capacity: '',
  insuranceStartDate: '',
  insuranceEndDate: '',
  cascoStartDate: '',
  cascoEndDate: '',
  lastOilMaintenanceKm: '',
  lastOilMaintenanceDate: '',
  tireChangeDate: '',
  tireChangeKm: '',
  inspectionDueDate: '',
  driverName: '',
  active: true,
})

const addOneYear = (date: string) => {
  if (!date) return ''
  const value = new Date(`${date}T00:00:00`)
  value.setFullYear(value.getFullYear() + 1)
  return value.toISOString().slice(0, 10)
}

const displayDate = (date?: string | null) => {
  if (!date) return '-'

  const value = new Date(`${date}T00:00:00`)
  return Number.isNaN(value.getTime()) ? '-' : new Intl.DateTimeFormat('tr-TR').format(value)
}

const displayKilometers = (kilometers?: string | null) => {
  const numericValue = Number(String(kilometers ?? '').replace(/\D/g, ''))
  return Number.isFinite(numericValue) && numericValue > 0 ? new Intl.NumberFormat('tr-TR').format(numericValue) : '-'
}

export function ShipmentWindow() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [form, setForm] = useState<Vehicle>(emptyVehicle)
  const [editingPlate, setEditingPlate] = useState<string | null>(null)
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
    fetch(`${apiUrl}/data/vehicles`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: Vehicle[]) => setVehicles(payload))
      .catch(() => window.alert('Araç kayıtları veritabanından alınamadı.'))
  }, [apiUrl])

  const closeForm = () => {
    setForm(emptyVehicle())
    setEditingPlate(null)
    setShowForm(false)
  }

  const updateField = (field: keyof Vehicle, value: string | boolean) => {
    setForm((current) => {
      const next = { ...current, [field]: value }
      if (field === 'insuranceStartDate' && typeof value === 'string') next.insuranceEndDate = addOneYear(value)
      if (field === 'cascoStartDate' && typeof value === 'string') next.cascoEndDate = addOneYear(value)
      return next
    })
  }

  const saveVehicle = async () => {
    if (!form.plate.trim() || !form.licenseNumber.trim() || !form.insuranceStartDate || !form.cascoStartDate) {
      window.alert('Plaka, ruhsat numarası, sigorta ve kasko başlangıç tarihleri zorunludur.')
      return
    }

    const response = await fetch(`${apiUrl}/data/vehicles${editingPlate ? `/${encodeURIComponent(editingPlate)}` : ''}`, {
      method: editingPlate ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ ...form, plate: form.plate.trim().toUpperCase(), licenseNumber: form.licenseNumber.trim() }),
    })
    if (!response.ok) return window.alert('Araç kaydedilemedi.')

    const saved = await response.json() as Vehicle
    setVehicles((current) => editingPlate ? current.map((vehicle) => vehicle.plate === editingPlate ? saved : vehicle) : [...current, saved])
    closeForm()
  }

  const editVehicle = (vehicle: Vehicle) => {
    setForm(vehicle)
    setEditingPlate(vehicle.plate)
    setShowForm(true)
  }

  const deleteVehicle = async (vehicle: Vehicle) => {
    if (!window.confirm(`${vehicle.plate} plakalı aracı silmek istediğinize emin misiniz?`)) return
    const response = await fetch(`${apiUrl}/data/vehicles/${encodeURIComponent(vehicle.plate)}`, { method: 'DELETE', headers: authHeaders })
    if (!response.ok) return window.alert('Araç silinemedi.')
    setVehicles((current) => current.filter((item) => item.plate !== vehicle.plate))
  }

  return (
    <div className="shipment-window">
      {showForm && <section className="shipment-form-panel">
        <div className="definition-panel-heading">
          <div><p className="definition-kicker">SEVKİYAT ARACI</p><h2>{editingPlate ? 'Araç Düzenle' : 'Yeni Araç'}</h2></div>
          <button className="ghost-button" onClick={closeForm} type="button">Kapat</button>
        </div>
        <div className="shipment-form-grid">
          <label>Araç Plakası<input value={form.plate} onChange={(event) => updateField('plate', event.target.value)} placeholder="07 ABC 123" disabled={Boolean(editingPlate)} /></label>
          <label>Ruhsat Numarası<input value={form.licenseNumber} onChange={(event) => updateField('licenseNumber', event.target.value)} placeholder="Ruhsat numarası" /></label>
          <label>Araç Tipi<select value={form.vehicleType} onChange={(event) => updateField('vehicleType', event.target.value)}><option>Kamyonet</option><option>Kamyon</option><option>Tır</option><option>Panelvan</option><option>Soğutuculu Araç</option></select></label>
          <label>Marka / Model<input value={form.brandModel} onChange={(event) => updateField('brandModel', event.target.value)} placeholder="Marka ve model" /></label>
          <label>Model Yılı<input inputMode="numeric" value={form.modelYear} onChange={(event) => updateField('modelYear', event.target.value)} placeholder="2025" /></label>
          <label>Taşıma Kapasitesi<input value={form.capacity} onChange={(event) => updateField('capacity', event.target.value)} placeholder="1.500 kg" /></label>
          <label>Sigorta Başlangıç<input type="date" value={form.insuranceStartDate} onChange={(event) => updateField('insuranceStartDate', event.target.value)} /></label>
          <label>Sigorta Bitiş<input type="date" value={form.insuranceEndDate} readOnly /></label>
          <label>Kasko Başlangıç<input type="date" value={form.cascoStartDate} onChange={(event) => updateField('cascoStartDate', event.target.value)} /></label>
          <label>Kasko Bitiş<input type="date" value={form.cascoEndDate} readOnly /></label>
          <label>Son Yağ Bakım Kilometresi<input inputMode="numeric" value={form.lastOilMaintenanceKm} onChange={(event) => updateField('lastOilMaintenanceKm', event.target.value)} placeholder="85.000" /></label>
          <label>Son Yağ Bakım Tarihi<input type="date" value={form.lastOilMaintenanceDate} onChange={(event) => updateField('lastOilMaintenanceDate', event.target.value)} /></label>
          <label>Lastik Değişim Kilometresi<input inputMode="numeric" value={form.tireChangeKm} onChange={(event) => updateField('tireChangeKm', event.target.value)} placeholder="80.000" /></label>
          <label>Lastik Değişim Tarihi<input type="date" value={form.tireChangeDate} onChange={(event) => updateField('tireChangeDate', event.target.value)} /></label>
          <label>Muayene Son Tarihi<input type="date" value={form.inspectionDueDate} onChange={(event) => updateField('inspectionDueDate', event.target.value)} /></label>
          <label>Sürücü<input value={form.driverName} onChange={(event) => updateField('driverName', event.target.value)} placeholder="Sürücü adı" /></label>
        </div>
        <button className="primary-action" onClick={saveVehicle} type="button">{editingPlate ? 'Değişiklikleri Kaydet' : 'Aracı Kaydet'}</button>
      </section>}

      <section className="shipment-list-panel">
        <div className="customers-toolbar"><div><strong>Sevkiyat Araçları</strong><span>{vehicles.length} kayıt</span></div><button className="primary-action" onClick={() => showForm ? closeForm() : setShowForm(true)} type="button">{showForm ? 'Formu Kapat' : 'Yeni'}</button></div>
        <div className="customers-table-wrap"><table className="customers-table shipment-table"><thead><tr><th>Plaka</th><th>Ruhsat No</th><th>Araç</th><th>Sigorta Bitiş</th><th>Kasko Bitiş</th><th>Yağ Bakımı</th><th>Lastik Değişimi</th><th>Muayene</th><th>Sürücü</th><th>İşlemler</th></tr></thead><tbody>{vehicles.map((vehicle) => <tr key={vehicle.plate}><td className="customer-code">{vehicle.plate}</td><td>{vehicle.licenseNumber}</td><td>{vehicle.brandModel || vehicle.vehicleType}</td><td>{displayDate(vehicle.insuranceEndDate)}</td><td>{displayDate(vehicle.cascoEndDate)}</td><td>{displayKilometers(vehicle.lastOilMaintenanceKm)} / {displayDate(vehicle.lastOilMaintenanceDate)}</td><td>{displayKilometers(vehicle.tireChangeKm)} / {displayDate(vehicle.tireChangeDate)}</td><td>{displayDate(vehicle.inspectionDueDate)}</td><td>{vehicle.driverName || '-'}</td><td><div className="user-row-actions"><button onClick={() => editVehicle(vehicle)} type="button">Düzenle</button><button className="delete-action" onClick={() => deleteVehicle(vehicle)} type="button">Sil</button></div></td></tr>)}</tbody></table></div>
      </section>
    </div>
  )
}
