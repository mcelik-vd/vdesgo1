import { useEffect, useState } from 'react'

type Warehouse = {
  code: string
  name: string
  type: string
  area: string
  active: boolean
}

export function WarehouseWindow() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [form, setForm] = useState({ code: '', name: '', type: 'Merkez Depo', area: '' })
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [allowDelete] = useState(() => {
    const storedUser = localStorage.getItem('vdesgo-user')
    if (!storedUser) {
      return false
    }

    try {
      const user = JSON.parse(storedUser)
      return user.accountType === 'factory'
    } catch {
      return false
    }
  })
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
    fetch(`${apiUrl}/data/warehouses`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: Warehouse[]) => setWarehouses(payload))
      .catch(() => window.alert('Depo kayıtları veritabanından alınamadı.'))
  }, [apiUrl])

  const resetForm = () => {
    setForm({ code: '', name: '', type: 'Merkez Depo', area: '' })
    setEditingCode(null)
    setShowForm(false)
  }

  const toggleForm = async () => {
    if (showForm) {
      resetForm()
      return
    }

    setEditingCode(null)
    const response = await fetch(`${apiUrl}/data/warehouses/next-code`, { headers: authHeaders })
    if (!response.ok) return window.alert('Yeni depo kodu alınamadı.')
    const { code } = await response.json() as { code: string }
    setForm({ code, name: '', type: 'Merkez Depo', area: '' })
    setShowForm(true)
  }

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const addWarehouse = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.area.trim()) return
    const response = await fetch(`${apiUrl}/data/warehouses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ ...form, active: true }),
    })
    if (!response.ok) return window.alert('Depo kaydedilemedi.')
    const created = await response.json() as Warehouse
    setWarehouses((current) => [...current, created])
    resetForm()
  }

  const startEdit = (warehouse: Warehouse) => {
    const confirmed = window.confirm(`${warehouse.name} deposunu düzenlemek istediğinize emin misiniz?`)
    if (!confirmed) return

    setEditingCode(warehouse.code)
    setForm({
      code: warehouse.code,
      name: warehouse.name,
      type: warehouse.type,
      area: warehouse.area,
    })
  }

  const saveEdit = async () => {
    if (!editingCode) return

    const updatedName = form.name.trim()
    const updatedArea = form.area.trim()
    if (!updatedName || !updatedArea) return

    const response = await fetch(`${apiUrl}/data/warehouses/${encodeURIComponent(editingCode)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ name: updatedName, type: form.type, area: updatedArea, active: true }),
    })
    if (!response.ok) return window.alert('Depo güncellenemedi.')
    const updated = await response.json() as Warehouse
    setWarehouses((current) => current.map((warehouse) => warehouse.code === editingCode ? updated : warehouse))

    resetForm()
  }

  const deleteWarehouse = async (code: string) => {
    if (!allowDelete) return

    const target = warehouses.find((warehouse) => warehouse.code === code)
    if (!target) return

    const confirmed = window.confirm(`${target.name} deposunu silmek istediğinize emin misiniz?`)
    if (!confirmed) return

    const response = await fetch(`${apiUrl}/data/warehouses/${encodeURIComponent(code)}`, { method: 'DELETE', headers: authHeaders })
    if (!response.ok) return window.alert('Depo silinemedi.')
    setWarehouses((current) => current.filter((warehouse) => warehouse.code !== code))
    if (editingCode === code) {
      resetForm()
    }
  }

  return (
    <div className="warehouse-window">
      {showForm && (
        <section className="definition-form-panel" aria-label="Yeni depo formu">
          <div className="definition-panel-heading">
            <div>
              <p className="definition-kicker">DEPO KARTI</p>
              <h2>{editingCode ? 'Depo Düzenle' : 'Yeni Depo'}</h2>
            </div>
            <span className="mock-badge">MERKEZ + DAĞITIM</span>
          </div>
          <div className="warehouse-form-grid">
            <label>
              Depo Kodu
              <input
                value={form.code}
                onChange={(event) => updateField('code', event.target.value)}
                placeholder="DEP-004"
                disabled={Boolean(editingCode)}
              />
            </label>
            <label>Depo Adı<input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Depo adı" /></label>
            <label>Depo Tipi<select value={form.type} onChange={(event) => updateField('type', event.target.value)}><option>Merkez Depo</option><option>Bolge Deposu</option><option>Iade Deposu</option><option>Arac Deposu</option><option>Gecici Depo</option></select></label>
            <label>Depo m²<input value={form.area} onChange={(event) => updateField('area', event.target.value)} placeholder="1200" /></label>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            {editingCode && (
              <button className="ghost-button" onClick={resetForm} type="button">İptal</button>
            )}
            <button className="ghost-button" onClick={toggleForm} type="button">Kapat</button>
            <button className="primary-action" onClick={editingCode ? saveEdit : addWarehouse} type="button">
              {editingCode ? 'Düzenle' : 'Depo Ekle'}
            </button>
          </div>
        </section>
      )}
      <section className="warehouse-list-panel" aria-label="Depo listesi">
        <div className="customers-toolbar">
          <div>
            <strong>Depo Listesi</strong>
            <span>{warehouses.length} kayıt</span>
          </div>
          <button className="primary-action" onClick={toggleForm} type="button">
            {showForm ? 'Formu Kapat' : 'Yeni'}
          </button>
        </div>
        <div className="customers-table-wrap">
          <table className="customers-table warehouse-table">
            <thead><tr><th>Kod</th><th>Depo Adı</th><th>Tip</th><th>m²</th><th>Durum</th>{allowDelete && <th>İşlem</th>}</tr></thead>
            <tbody>
              {warehouses.map((warehouse) => (
                <tr
                  key={warehouse.code}
                  onDoubleClick={() => startEdit(warehouse)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="customer-code">{warehouse.code}</td>
                  <td>{warehouse.name}</td>
                  <td>{warehouse.type}</td>
                  <td>{warehouse.area}</td>
                  <td><span className={warehouse.active ? 'status-active' : 'status-inactive'}>{warehouse.active ? 'Aktif' : 'Pasif'}</span></td>
                  {allowDelete && (
                    <td>
                      <button className="ghost-button" onClick={() => deleteWarehouse(warehouse.code)} type="button">Sil</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}
