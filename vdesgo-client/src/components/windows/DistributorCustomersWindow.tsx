import { useEffect, useRef, useState } from 'react'

type Customer = {
  code: string
  name: string
  title: string
  province: string
  district: string
  phone: string
  mobilePhone: string
  taxOffice: string
  taxNo: string
  address: string
  location: string
  areaM2: string
  customerGroupCode: string
  customerDiscount1: string
  customerDiscount2: string
  customerDiscount3: string
  cashDiscount: string
  deferredDiscount: string
  active: boolean
  type?: string
  territory?: string
  salesRepresentative?: string
  balance?: string
}

type CustomerGroup = { code: string; name: string }

const emptyForm = () => ({ code: '', name: '', title: '', province: '', district: '', phone: '', mobilePhone: '', taxOffice: '', taxNo: '', address: '', location: '', areaM2: '', type: 'Perakende', customerGroupCode: '', customerDiscount1: '', customerDiscount2: '', customerDiscount3: '', cashDiscount: '', deferredDiscount: '', active: true })
const customerTypeOptions = ['Perakende', 'Horeca']

const districtsByProvince: Record<string, string[]> = {
  Antalya: ['Akseki', 'Alanya', 'Kemer', 'Kepez', 'Konyaaltı', 'Manavgat', 'Muratpaşa', 'Serik'],
  Burdur: ['Bucak', 'Gölhisar', 'Merkez', 'Tefenni'],
  İzmir: ['Bornova', 'Buca', 'Karşıyaka', 'Konak', 'Urla'],
}
const provinceOptions = Object.keys(districtsByProvince)

export function DistributorCustomersWindow() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hoveredCustomer, setHoveredCustomer] = useState<Customer | null>(null)
  const customerHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders = (() => {
    try {
      const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}')
      return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' }
    } catch { return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' } }
  })()

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/data/customers`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiUrl}/data/customerGroups`).then((response) => response.ok ? response.json() : Promise.reject()),
    ])
      .then(([customerData, groupData]) => { setCustomers(customerData); setGroups(groupData) })
      .catch(() => window.alert('Cari kart kayıtları veritabanından alınamadı.'))
  }, [apiUrl])

  const closeForm = () => { setForm(emptyForm()); setEditingCode(null); setShowForm(false) }

  const openNew = async () => {
    const response = await fetch(`${apiUrl}/data/customers/next-code`, { headers: authHeaders })
    if (!response.ok) return window.alert('Yeni müşteri kodu alınamadı.')
    const { code } = await response.json() as { code: string }
    setForm({ ...emptyForm(), code, customerGroupCode: groups[0]?.code || '' })
    setEditingCode(null)
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.title.trim() || !form.customerGroupCode) {
      window.alert('Müşteri adı, işyeri ünvanı ve cari grup zorunludur.')
      return
    }
    const record = { ...form, name: form.name.trim(), title: form.title.trim(), type: form.type || 'Perakende', territory: '', salesRepresentative: '', phone: form.phone.trim(), mobilePhone: form.mobilePhone.trim(), taxNo: form.taxNo.trim(), taxOffice: form.taxOffice.trim(), address: form.address.trim(), location: form.location.trim(), areaM2: form.areaM2.trim(), balance: '0,00 TL' }
    const response = await fetch(`${apiUrl}/data/customers${editingCode ? `/${encodeURIComponent(editingCode)}` : ''}`, {
      method: editingCode ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(record),
    })
    if (!response.ok) return window.alert('Cari kart kaydedilemedi.')
    const saved = await response.json() as Customer
    setCustomers((current) => editingCode ? current.map((item) => item.code === editingCode ? saved : item) : [...current, saved])
    closeForm()
  }

  const edit = (customer: Customer) => { setForm({ ...emptyForm(), ...customer }); setEditingCode(customer.code); setShowForm(true) }

  const groupName = (code: string) => groups.find((group) => group.code === code)?.name || '-'
  const districtOptions = districtsByProvince[form.province] ?? []
  const filteredCustomers = customers.filter((customer) => {
    const searchText = customerSearch.trim().toLocaleLowerCase('tr-TR')
    if (!searchText) return true
    return [customer.code, customer.name, customer.title, customer.province, customer.district, customer.address, customer.location, customer.phone, customer.mobilePhone, customer.taxNo]
      .some((value) => value.toLocaleLowerCase('tr-TR').includes(searchText))
  })
  const startCustomerHover = (customer: Customer) => {
    if (customerHoverTimer.current) clearTimeout(customerHoverTimer.current)
    setHoveredCustomer(null)
    customerHoverTimer.current = setTimeout(() => setHoveredCustomer(customer), 1000)
  }
  const clearCustomerHover = () => {
    if (customerHoverTimer.current) clearTimeout(customerHoverTimer.current)
    customerHoverTimer.current = null
    setHoveredCustomer(null)
  }

  return <div className="distributor-customers-window">
    {showForm && <section className="shipment-form-panel">
      <div className="definition-panel-heading"><div><p className="definition-kicker">DİSTRİBÜTÖR CARİ KARTI</p><h2>{editingCode ? 'Cari Kart Düzenle' : 'Yeni Cari Kart'}</h2></div><button className="ghost-button" onClick={closeForm} type="button">Kapat</button></div>
      <div className="shipment-form-grid">
        <label>Müşteri Kodu<input value={form.code} readOnly /></label>
        <label>Müşteri Adı<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Müşteri adı" /></label>
        <label>İşyeri Ünvanı<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="İşyeri ünvanı" /></label>
        <label>İl<select value={form.province} onChange={(event) => setForm({ ...form, province: event.target.value, district: '' })}><option value="">İl seçiniz</option>{provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
        <label>İlçe<select value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })}><option value="">İlçe seçiniz</option>{districtOptions.map((district) => <option key={district} value={district}>{district}</option>)}</select></label>
        <label>Adres<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Adres bilgisi" /></label>
        <label>Konum<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Harita konumu veya koordinat" /></label>
        <label>Alan (M²)<input inputMode="decimal" min="0" type="number" value={form.areaM2} onChange={(event) => setForm({ ...form, areaM2: event.target.value })} placeholder="0" /></label>
        <label>Telefon<input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="0XXX XXX XX XX" /></label>
        <label>Cep Telefonu<input inputMode="tel" value={form.mobilePhone} onChange={(event) => setForm({ ...form, mobilePhone: event.target.value })} placeholder="05XX XXX XX XX" /></label>
        <label>Vergi Dairesi<input value={form.taxOffice} onChange={(event) => setForm({ ...form, taxOffice: event.target.value })} placeholder="Vergi dairesi" /></label>
        <label>Vergi No<input value={form.taxNo} onChange={(event) => setForm({ ...form, taxNo: event.target.value })} placeholder="Vergi numarası" /></label>
        <label>Müşteri Tipi<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{customerTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label>Cari Grup<select value={form.customerGroupCode} onChange={(event) => setForm({ ...form, customerGroupCode: event.target.value })}><option value="">Cari grup seçiniz</option>{groups.map((group) => <option key={group.code} value={group.code}>{group.name}</option>)}</select></label>
        <label>Müşteri İsk1 (%)<input inputMode="decimal" value={form.customerDiscount1} onChange={(event) => setForm({ ...form, customerDiscount1: event.target.value })} placeholder="0" /></label>
        <label>Müşteri İsk2 (%)<input inputMode="decimal" value={form.customerDiscount2} onChange={(event) => setForm({ ...form, customerDiscount2: event.target.value })} placeholder="0" /></label>
        <label>Müşteri İsk3 (%)<input inputMode="decimal" value={form.customerDiscount3} onChange={(event) => setForm({ ...form, customerDiscount3: event.target.value })} placeholder="0" /></label>
        <label>Nakit İsk (%)<input inputMode="decimal" value={form.cashDiscount} onChange={(event) => setForm({ ...form, cashDiscount: event.target.value })} placeholder="0" /></label>
        <label>Vadeli İsk (%)<input inputMode="decimal" value={form.deferredDiscount} onChange={(event) => setForm({ ...form, deferredDiscount: event.target.value })} placeholder="0" /></label>
        <label>Durum<select value={form.active ? 'active' : 'passive'} onChange={(event) => setForm({ ...form, active: event.target.value === 'active' })}><option value="active">Aktif</option><option value="passive">Pasif</option></select></label>
      </div>
      <button className="primary-action" onClick={save} type="button">{editingCode ? 'Değişiklikleri Kaydet' : 'Cari Kartı Kaydet'}</button>
    </section>}
    <section className="shipment-list-panel"><div className="customers-toolbar"><div><strong>Müşteri Listesi</strong><span>{filteredCustomers.length} kayıt</span></div><div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><label><span className="sr-only">Müşteri ara</span><input aria-label="Müşteri ara" onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Müşteri ara..." type="search" value={customerSearch} /></label><button className="primary-action" onClick={() => showForm ? closeForm() : void openNew()} type="button">{showForm ? 'Formu Kapat' : 'Yeni'}</button></div></div>
      <div className="customers-table-wrap"><table className="customers-table distributor-customers-table"><thead><tr><th>Müşteri Kodu</th><th>Müşteri Adı</th><th>İşyeri Ünvanı</th><th>İl</th><th>İlçe</th><th>Adres</th><th>Konum</th><th>M²</th><th>Telefon</th><th>Cep Telefonu</th><th>Vergi Dairesi</th><th>Vergi No</th><th>Tip</th><th>Cari Grup</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>{filteredCustomers.map((customer) => <tr className={customer.active ? '' : 'customer-inactive'} key={customer.code} onMouseEnter={() => startCustomerHover(customer)} onMouseLeave={clearCustomerHover}><td className="customer-code">{customer.code}</td><td>{customer.name}</td><td>{customer.title}</td><td>{customer.province || '-'}</td><td>{customer.district || '-'}</td><td>{customer.address || '-'}</td><td>{customer.location || '-'}</td><td>{customer.areaM2 || '-'}</td><td>{customer.phone || '-'}</td><td>{customer.mobilePhone || '-'}</td><td>{customer.taxOffice || '-'}</td><td>{customer.taxNo || '-'}</td><td>{customer.type || 'Perakende'}</td><td>{groupName(customer.customerGroupCode)}</td><td>{customer.active ? 'Aktif' : 'Pasif'}</td><td><div className="user-row-actions"><button onClick={() => edit(customer)} type="button">Düzenle</button></div></td></tr>)}</tbody></table></div>
    </section>
    {hoveredCustomer && <div className="customer-hover-toast" role="status"><strong>{hoveredCustomer.name} · {hoveredCustomer.title}</strong><div className="customer-hover-toast-details"><span><b>Kod:</b> {hoveredCustomer.code}</span><span><b>Durum:</b> {hoveredCustomer.active ? 'Aktif' : 'Pasif'}</span><span><b>İl / İlçe:</b> {hoveredCustomer.province || '-'} / {hoveredCustomer.district || '-'}</span><span><b>Tip:</b> {hoveredCustomer.type || 'Perakende'}</span><span><b>Cari Grup:</b> {groupName(hoveredCustomer.customerGroupCode)}</span><span><b>Bölge:</b> {hoveredCustomer.territory || '-'}</span><span><b>Şef:</b> {hoveredCustomer.salesRepresentative || '-'}</span><span><b>M²:</b> {hoveredCustomer.areaM2 || '-'}</span><span><b>Telefon:</b> {hoveredCustomer.phone || '-'}</span><span><b>Cep:</b> {hoveredCustomer.mobilePhone || '-'}</span><span><b>Vergi No:</b> {hoveredCustomer.taxNo || '-'}</span><span><b>Vergi Dairesi:</b> {hoveredCustomer.taxOffice || '-'}</span><span><b>Konum:</b> {hoveredCustomer.location || '-'}</span><span><b>Bakiye:</b> {hoveredCustomer.balance || '-'}</span><span className="customer-hover-toast-wide"><b>Adres:</b> {hoveredCustomer.address || '-'}</span></div></div>}
  </div>
}