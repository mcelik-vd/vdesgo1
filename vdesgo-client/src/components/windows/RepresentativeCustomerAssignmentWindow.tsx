import { useEffect, useState } from 'react'

type Representative = { id: number; name: string; active: boolean }
type Customer = { code: string; name: string; title: string; province: string; district: string; active: boolean }
type RouteRecord = { id: number; routeDay: string; salesRepresentativeId: number; salesRepresentativeName: string; customerCode: string; customerName: string; customerTitle: string; province: string; district: string }
const days = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

export function RepresentativeCustomerAssignmentWindow() {
  const [representatives, setRepresentatives] = useState<Representative[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [routes, setRoutes] = useState<RouteRecord[]>([])
  const [representativeId, setRepresentativeId] = useState('')
  const [routeDay, setRouteDay] = useState(days[0])
  const [province, setProvince] = useState('')
  const [district, setDistrict] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const authHeaders: Record<string, string> = (() => { try { const user = JSON.parse(localStorage.getItem('vdesgo-user') || '{}'); return { 'x-vdesgo-account-type': user.accountType || '', 'x-vdesgo-username': user.username || '' } } catch { return { 'x-vdesgo-account-type': '', 'x-vdesgo-username': '' } } })()

  const loadRoutes = () => fetch(`${apiUrl}/representative-routes`, { headers: authHeaders }).then((response) => response.ok ? response.json() : Promise.reject()).then((data: RouteRecord[]) => setRoutes(data)).catch(() => setMessage('Rut kayıtları alınamadı.'))
  useEffect(() => {
    Promise.all([fetch(`${apiUrl}/data/salesRepresentatives`, { headers: authHeaders }), fetch(`${apiUrl}/data/customers`, { headers: authHeaders })]).then(async ([repResponse, customerResponse]) => {
      if (!repResponse.ok || !customerResponse.ok) throw new Error()
      setRepresentatives((await repResponse.json()).filter((item: Representative) => item.active)); setCustomers((await customerResponse.json()).filter((item: Customer) => item.active)); await loadRoutes()
    }).catch(() => setMessage('Temsilci ve cari kayıtları alınamadı.'))
  }, [apiUrl])

  const visibleRoutes = routes.filter((route) => Boolean(representativeId) && route.salesRepresentativeId === Number(representativeId) && route.routeDay === routeDay)
  const assignedCodes = new Set(visibleRoutes.map((route) => route.customerCode))
  useEffect(() => { setSelectedCodes(visibleRoutes.map((route) => route.customerCode)) }, [representativeId, routeDay, routes])
  const provinces = [...new Set(customers.map((customer) => customer.province).filter(Boolean))]
  const districts = [...new Set(customers.filter((customer) => !province || customer.province === province).map((customer) => customer.district).filter(Boolean))]
  const filteredCustomers = customers.filter((customer) => { const query = customerSearch.trim().toLocaleLowerCase('tr-TR'); return (!query || [customer.code, customer.name, customer.title, customer.province, customer.district].some((value) => value.toLocaleLowerCase('tr-TR').includes(query))) && (!province || customer.province === province) && (!district || customer.district === district) })
  const addCustomer = (code: string) => {
    if (!representativeId) { window.alert('Önce satış temsilcisi seçiniz.'); return }
    if (assignedCodes.has(code)) return
    const otherAssignments = routes.filter((route) => route.customerCode === code && !(route.salesRepresentativeId === Number(representativeId) && route.routeDay === routeDay))
    if (otherAssignments.length > 0) {
      const assignmentText = otherAssignments.map((route) => `${route.salesRepresentativeName} / ${route.routeDay}`).join(', ')
      if (!window.confirm(`Bu cari daha önce ${assignmentText} kaydında bulunuyor. Yine de kaydedilsin mi?`)) return
    }
    setSelectedCodes((current) => current.includes(code) ? current : [...current, code])
  }
  const removeCustomer = async (code: string) => {
    const route = visibleRoutes.find((item) => item.customerCode === code)
    if (!window.confirm('Bu cariyi günlük rut listesinden çıkarmak istediğinize emin misiniz?')) return
    if (route) {
      const response = await fetch(`${apiUrl}/representative-routes/${route.id}`, { method: 'DELETE', headers: authHeaders })
      if (!response.ok) return setMessage('Cari rut listesinden çıkarılamadı.')
      await loadRoutes()
      return
    }
    setSelectedCodes((current) => current.filter((item) => item !== code))
  }
  const save = async () => {
    if (!representativeId || !routeDay || selectedCodes.length === 0) return setMessage('Temsilci, gün ve en az bir cari seçiniz.')
    const response = await fetch(`${apiUrl}/representative-routes`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ salesRepresentativeId: Number(representativeId), routeDay, customerCodes: selectedCodes }) })
    if (!response.ok) { const error = await response.json().catch(() => ({})) as { error?: string }; return setMessage(error.error || 'Rut kaydedilemedi.') }
    setMessage('Günlük rut müşterileri kaydedildi.'); await loadRoutes()
  }

  return <div className="representative-assignment-window"><div className="assignment-columns"><section className="definition-panel assignment-panel"><div className="definition-panel-heading"><div><p className="definition-kicker">RUT MÜŞTERİ ATAMASI</p><h2>Müşteri Seçimi</h2></div></div><div className="assignment-filters"><label>Satış Temsilcisi<select value={representativeId} onChange={(event) => setRepresentativeId(event.target.value)}><option value="">Temsilci seçiniz</option>{representatives.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Gün<select value={routeDay} onChange={(event) => setRouteDay(event.target.value)}>{days.map((day) => <option key={day} value={day}>{day}</option>)}</select></label><label>İl<select value={province} onChange={(event) => { setProvince(event.target.value); setDistrict('') }}><option value="">Tüm iller</option>{provinces.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>İlçe<select value={district} onChange={(event) => setDistrict(event.target.value)}><option value="">Tüm ilçeler</option>{districts.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div><div className="assignment-customer-toolbar"><p className="assignment-hint">Uygun cari üzerine tıklayarak günlük rut listesine ekleyin.</p><input aria-label="Cari listesinde ara" onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Cari ara..." type="search" value={customerSearch} /></div><div className="assignment-customer-list">{filteredCustomers.map((customer) => <button className={`${selectedCodes.includes(customer.code) ? 'is-selected ' : ''}${assignedCodes.has(customer.code) ? 'is-assigned' : ''}`} key={customer.code} onClick={() => addCustomer(customer.code)} type="button"><strong>{customer.name}</strong><span>{customer.title} · {customer.province || '-'} / {customer.district || '-'}</span></button>)}</div></section><section className="definition-panel assignment-panel"><div className="definition-panel-heading"><div><p className="definition-kicker">SEÇİLENLER</p><h2>{routeDay} Rut Müşterileri</h2></div><button className="primary-action" onClick={() => void save()} type="button">Kaydet</button></div><div className="assignment-selected-list">{selectedCodes.map((code) => { const customer = customers.find((item) => item.code === code); return customer && <div key={code}><span>{customer.name} · {customer.title}</span><button className="danger-button" onClick={() => void removeCustomer(code)} type="button">Çıkar</button></div> })}</div><div className="assignment-saved-heading"><strong>Kaydedilmiş Günlük Rut</strong><span>{visibleRoutes.length} müşteri</span></div><div className="assignment-saved-list">{visibleRoutes.map((route) => <div key={route.id}><span><b>{route.customerName}</b> · {route.customerTitle}</span><small>{route.province || '-'} / {route.district || '-'}</small></div>)}</div></section></div>{message && <p className="unit-error" role="alert">{message}</p>}</div>
}
