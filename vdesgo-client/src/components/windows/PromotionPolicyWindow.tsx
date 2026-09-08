import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'

type Option = { code: string; name: string }
type ProductUnit = { productCode: string; unit: string; innerQuantity: string }
type Promotion = {
  id: number; code: string; name: string; promotionType: string; conditionType: string; conditionUnit: string
  threshold: number; rewardValue: number; rewardType: string; rewardProductCodes: string[]; rewardProductUnits: Record<string, string>
  priority: number; startDate: string; endDate: string | null; active: boolean; customerTypeCodes: string[]; customerGroupCodes: string[]
  customerCodes: string[]; productTypeCodes: string[]; productGroupCodes: string[]; productCodes: string[]
}
type PromotionForm = Omit<Promotion, 'id'>
const dateInDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}
const emptyForm: PromotionForm = {
  code: '', name: '', promotionType: 'free_goods', conditionType: 'min_quantity_product', conditionUnit: 'Adet', threshold: 1,
  rewardValue: 1, rewardType: 'free_goods', rewardProductCodes: [], rewardProductUnits: {}, priority: 50,
  startDate: dateInDays(0), endDate: dateInDays(30), active: true, customerTypeCodes: [], customerGroupCodes: [],
  customerCodes: [], productTypeCodes: [], productGroupCodes: [], productCodes: [],
}
const labels: Record<string, string> = { free_goods: 'Bedelsiz ürün', discount: 'İskonto', min_quantity_product: 'Ürün miktarı', min_basket_amount: 'Sepet tutarı', min_distinct_sku: 'Ürün çeşidi' }
const unitNames = ['Adet', 'Kutu', 'Koli']

export function PromotionPolicyWindow() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const [tab, setTab] = useState('Politika Listesi')
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [form, setForm] = useState<PromotionForm>({ ...emptyForm, startDate: dateInDays(0), endDate: dateInDays(30) })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [options, setOptions] = useState<Record<string, Option[]>>({})
  const [productUnits, setProductUnits] = useState<ProductUnit[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [pickerKey, setPickerKey] = useState<keyof PromotionForm | null>(null)
  const [rewardPickerOpen, setRewardPickerOpen] = useState(false)
  const [filters, setFilters] = useState({ products: '', customers: '' })

  const load = async () => {
    try {
      const resources = ['promotions', 'customerTypes', 'customerGroups', 'customers', 'productTypes', 'productGroups', 'products', 'productUnits']
      const responses = await Promise.all(resources.map((resource) => fetch(`${apiUrl}/${resource === 'promotions' ? resource : `data/${resource}`}`)))
      const data = await Promise.all(responses.map((response) => response.ok ? response.json() : Promise.reject()))
      setPromotions(data[0])
      setOptions({
        customerTypeCodes: data[1], customerGroupCodes: data[2],
        customerCodes: data[3].map((item: Option & { title?: string }) => ({ code: item.code, name: item.title || item.name })),
        productTypeCodes: data[4], productGroupCodes: data[5], productCodes: data[6],
      })
      setProductUnits(data[7])
    } catch { setError('Promosyon verileri yüklenemedi.') }
  }
  useEffect(() => { void load() }, [])

  const update = <K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  const toggle = (key: keyof PromotionForm, code: string) => {
    const values = form[key] as string[]
    update(key, (values.includes(code) ? values.filter((item) => item !== code) : [...values, code]) as PromotionForm[typeof key])
  }
  const selectAll = (key: keyof PromotionForm, source: Option[]) => update(key, Array.from(new Set(source.map((item) => item.code))) as PromotionForm[typeof key])
  const clearSelection = (key: keyof PromotionForm) => update(key, [] as PromotionForm[typeof key])
  const unitsFor = (code: string) => productUnits.filter((item) => item.productCode === code)
  const toggleRewardProduct = (code: string) => {
    toggle('rewardProductCodes', code)
    if (form.rewardProductCodes.includes(code)) {
      const units = { ...form.rewardProductUnits }
      delete units[code]
      update('rewardProductUnits', units)
    }
  }
  const nextCode = async () => {
    const response = await fetch(`${apiUrl}/promotions/next-code`)
    if (response.ok) update('code', (await response.json() as { code: string }).code)
  }
  const startNew = () => { setEditingId(null); setForm({ ...emptyForm, startDate: dateInDays(0), endDate: dateInDays(30) }); setTab('Yeni Politika'); void nextCode() }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (form.rewardType === 'free_goods' && form.rewardProductCodes.some((code) => !form.rewardProductUnits[code])) {
      setError('Her bedelsiz ürün için birim seçmelisiniz.'); return
    }
    const response = await fetch(`${apiUrl}/promotions${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (!response.ok) { setError('Promosyon kaydedilemedi.'); return }
    await load(); setForm({ ...emptyForm, startDate: dateInDays(0), endDate: dateInDays(30) }); setEditingId(null); setTab('Politika Listesi')
  }
  const optionNames = (codes: string[], key: string) => codes.map((code) => options[key]?.find((item) => item.code === code)?.name || code).join(', ') || 'Tümü'
  const renderScope = (label: string, key: keyof PromotionForm) => <fieldset className="promotion-filter-fieldset"><legend>{label}</legend><div className="promotion-scope-selection"><span>{(form[key] as string[]).length ? `${(form[key] as string[]).length} seçim` : 'Tümü seçili'}</span><button className="secondary-action" onClick={() => setPickerKey(key)} type="button">Seç</button></div></fieldset>
  const filtered = promotions.filter((item) => `${item.code} ${item.name}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')))
  const pickerSource = pickerKey ? options[pickerKey] || [] : []
  const pickerFilter = pickerKey === 'productCodes' ? filters.products : pickerKey === 'customerCodes' ? filters.customers : ''
  const visiblePickerOptions = pickerSource.filter((option) => !pickerFilter || `${option.code} ${option.name}`.toLocaleLowerCase('tr-TR').includes(pickerFilter.toLocaleLowerCase('tr-TR'))).sort((left, right) => Number((form[pickerKey as keyof PromotionForm] as string[]).includes(right.code)) - Number((form[pickerKey as keyof PromotionForm] as string[]).includes(left.code)))
  const pickerTitle = pickerKey === 'productCodes' ? 'Ürün seç' : pickerKey === 'productGroupCodes' ? 'Ürün grup seç' : pickerKey === 'productTypeCodes' ? 'Ürün tipi seç' : pickerKey === 'customerTypeCodes' ? 'Cari tipi seç' : pickerKey === 'customerGroupCodes' ? 'Cari grup seç' : 'Müşteri seç'

  return <div className="promotion-window">
    <div aria-label="Merkez promosyon sekmeleri" className="definition-tabs" role="tablist"><button aria-selected={tab === 'Politika Listesi'} className={tab === 'Politika Listesi' ? 'is-selected' : ''} onClick={() => setTab('Politika Listesi')} role="tab" type="button">Politika Listesi</button><button aria-selected={tab === 'Yeni Politika'} className={tab === 'Yeni Politika' ? 'is-selected' : ''} onClick={startNew} role="tab" type="button">Yeni Politika</button></div>
    {error && <p className="promotion-error">{error}</p>}
    {tab === 'Politika Listesi' ? <section className="promotion-panel"><div className="promotion-toolbar"><div><p className="definition-kicker">MERKEZ YÖNETİMİ</p><h2>Promosyon Politikaları</h2></div><div className="promotion-toolbar-actions"><input aria-label="Promosyon ara" onChange={(event) => setSearch(event.target.value)} placeholder="Kod veya ad ara" value={search} /><button className="primary-action" onClick={startNew} type="button"><Plus size={15} /> Yeni Politika</button></div></div><div className="promotion-table-wrap"><table className="customers-table promotion-table"><thead><tr><th>Kod / Ad</th><th>Koşul</th><th>Ödül</th><th>Durum</th><th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.code}</strong><br /><span>{item.name}</span></td><td>{labels[item.conditionType]} / {item.conditionUnit}<br /><small>{item.threshold}</small></td><td>{labels[item.rewardType]}<br /><small>{item.rewardType === 'free_goods' ? optionNames(item.rewardProductCodes, 'productCodes') : `%${item.rewardValue}`}</small></td><td><span className={item.active ? 'status-active' : 'status-inactive'}>{item.active ? 'Aktif' : 'Pasif'}</span></td><td><div className="user-row-actions"><button aria-label="Promosyonu düzenle" onClick={() => { setForm({ ...item, endDate: item.endDate || null, rewardProductUnits: item.rewardProductUnits || {} }); setEditingId(item.id); setTab('Yeni Politika') }} type="button"><Pencil size={14} /></button><button aria-label="Promosyonu sil" className="delete-action" onClick={() => { if (window.confirm('Bu promosyon politikasını silmek istiyor musunuz?')) void fetch(`${apiUrl}/promotions/${item.id}`, { method: 'DELETE' }).then(load) }} type="button"><Trash2 size={14} /></button></div></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="promotion-empty">Henüz promosyon politikası tanımlanmadı.</div>}</div></section> : <form className="promotion-panel" onSubmit={save}><div className="promotion-form-heading"><div><p className="definition-kicker">POLİTİKA TANIMI</p><h2>{editingId ? 'Promosyonu Düzenle' : 'Yeni Merkez Promosyonu'}</h2></div></div><div className="promotion-form-grid"><label>Otomatik kod<input readOnly value={form.code} /></label><label>Promosyon adı<input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label>Promosyon tipi<select value={form.promotionType} onChange={(event) => update('promotionType', event.target.value)}><option value="free_goods">Bedelsiz ürün</option><option value="discount">İskonto</option></select></label><label>Koşul tipi<select value={form.conditionType} onChange={(event) => update('conditionType', event.target.value)}><option value="min_quantity_product">Ürün miktarı</option><option value="min_basket_amount">Sepet tutarı</option><option value="min_distinct_sku">Ürün çeşidi</option></select></label><label>Eşik değeri<input min="1" required type="number" value={form.threshold} onChange={(event) => update('threshold', Number(event.target.value))} /></label><label>Eşik birimi<select value={form.conditionUnit} onChange={(event) => update('conditionUnit', event.target.value)}>{unitNames.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>Ödül değeri<input min="0" required type="number" value={form.rewardValue} onChange={(event) => update('rewardValue', Number(event.target.value))} /></label><label>Ödül tipi<select value={form.rewardType} onChange={(event) => update('rewardType', event.target.value)}><option value="free_goods">Ürün</option><option value="discount">İskonto</option></select></label><label>Başlangıç tarihi<input required type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></label><label>Bitiş tarihi<input type="date" value={form.endDate || ''} onChange={(event) => update('endDate', event.target.value || null)} /></label><label className="promotion-active-field"><input checked={form.active} onChange={(event) => update('active', event.target.checked)} type="checkbox" /> Aktif politika</label></div>{form.rewardType === 'free_goods' ? <div className="promotion-reward-picker-field"><button className="secondary-action" onClick={() => setRewardPickerOpen(true)} type="button">Bedelsiz ürün seç</button><span>{form.rewardProductCodes.length ? `${form.rewardProductCodes.length} ürün seçildi` : 'Henüz ürün seçilmedi'}</span></div> : <p className="panel-description">İskonto değeri yüzde olarak uygulanır.</p>}<div className="promotion-scope-heading"><h3>Uygulama kapsamı</h3><p>Cari ve ürün seçimleri boş bırakılırsa tüm kayıtlar için geçerli olur.</p></div><div className="promotion-scope-grid">{renderScope('Ürün', 'productCodes')}{renderScope('Ürün grup', 'productGroupCodes')}{renderScope('Ürün tipi', 'productTypeCodes')}{renderScope('Cari tipi', 'customerTypeCodes')}{renderScope('Cari grup', 'customerGroupCodes')}{renderScope('Müşteri', 'customerCodes')}</div><div className="promotion-form-actions"><button className="primary-action" type="submit">Politikayı Kaydet</button><button className="secondary-action" onClick={() => setTab('Politika Listesi')} type="button">Vazgeç</button></div></form>}
    {rewardPickerOpen && <div className="promotion-picker-backdrop" onClick={() => setRewardPickerOpen(false)}><section className="promotion-picker-dialog" onClick={(event) => event.stopPropagation()}><div className="promotion-picker-heading"><div><p className="definition-kicker">ÖDÜL ÜRÜNÜ</p><h2>Bedelsiz ürün seç</h2></div><button className="dialog-close" onClick={() => setRewardPickerOpen(false)} type="button">×</button></div><div className="promotion-selection-actions"><button className="secondary-action" onClick={() => selectAll('rewardProductCodes', options.productCodes || [])} type="button">Tümünü seç</button><button className="secondary-action" onClick={() => clearSelection('rewardProductCodes')} type="button">Seçimleri kaldır</button></div><div className="promotion-picker-list">{(options.productCodes || []).map((option) => <div className="promotion-product-unit-row" key={option.code}><label><input checked={form.rewardProductCodes.includes(option.code)} onChange={() => toggleRewardProduct(option.code)} type="checkbox" /><span><strong>{option.code}</strong> {option.name}</span></label>{form.rewardProductCodes.includes(option.code) && <select aria-label={`${option.name} ödül birimi`} value={form.rewardProductUnits[option.code] || ''} onChange={(event) => update('rewardProductUnits', { ...form.rewardProductUnits, [option.code]: event.target.value })}><option value="">Birim seç</option>{unitsFor(option.code).map((unit) => <option key={unit.unit} value={unit.unit}>{unit.unit}</option>)}</select>}</div>)}</div><div className="dialog-actions"><button className="primary-action" onClick={() => setRewardPickerOpen(false)} type="button">Seçimleri tamamla</button></div></section></div>}
    {pickerKey && <div className="promotion-picker-backdrop" onClick={() => setPickerKey(null)}><section className="promotion-picker-dialog" onClick={(event) => event.stopPropagation()}><div className="promotion-picker-heading"><div><p className="definition-kicker">UYGULAMA KAPSAMI</p><h2>{pickerTitle}</h2></div><button className="dialog-close" onClick={() => setPickerKey(null)} type="button">×</button></div>{(pickerKey === 'productCodes' || pickerKey === 'customerCodes') && <input autoFocus className="promotion-scope-filter" onChange={(event) => setFilters((current) => ({ ...current, [pickerKey === 'productCodes' ? 'products' : 'customers']: event.target.value }))} placeholder={pickerKey === 'productCodes' ? 'Ürünlerde filtrele...' : 'Müşterilerde filtrele...'} value={pickerFilter} /> }<div className="promotion-selection-actions"><button className="secondary-action" onClick={() => selectAll(pickerKey, pickerSource)} type="button">Tümünü seç</button><button className="secondary-action" onClick={() => clearSelection(pickerKey)} type="button">Seçimleri kaldır</button></div><div className="promotion-picker-list">{visiblePickerOptions.map((option) => <label key={option.code}><input checked={(form[pickerKey] as string[]).includes(option.code)} onChange={() => toggle(pickerKey, option.code)} type="checkbox" /><span><strong>{option.code}</strong> {option.name}</span></label>)}</div><div className="dialog-actions"><button className="primary-action" onClick={() => setPickerKey(null)} type="button">Seçimleri tamamla</button></div></section></div>}
  </div>
}
