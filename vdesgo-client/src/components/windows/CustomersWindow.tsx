import { useEffect, useRef, useState } from 'react'

type CustomerRow = {
  code: string
  name: string
  title: string
  province: string
  district: string
  type: string
  territory: string
  salesRepresentative: string
  phone: string
  mobilePhone: string
  taxNo: string
  taxOffice: string
  address: string
  location: string
  areaM2: string
  balance: string
  active: boolean
  customerGroupCode?: string | null
}

type RegionRow = {
  code: string
  name: string
  manager: string
  description: string
}

type CustomerTypeRow = {
  code: string
  name: string
}

type CustomerGroupRow = {
  code: string
  name: string
}

type ChiefRow = {
  code: string
  name: string
}

const initialCustomers: CustomerRow[] = [
  {
    code: '1042',
    name: 'Mehmet Demir',
    title: 'ABC Market',
    province: 'Antalya',
    district: 'Muratpaşa',
    type: 'Perakende',
    territory: 'Antalya Merkez',
    salesRepresentative: 'Ahmet Yilmaz',
    phone: '0242 123 45 67',
    mobilePhone: '0555 123 45 67',
    taxNo: '1234567890',
    taxOffice: 'Antalya',
    address: 'Muratpaşa, Antalya',
    location: '',
    areaM2: '',
    balance: '18.450,00 TL',
    active: true,
  },
  {
    code: '1187',
    name: 'Selami Güneş',
    title: 'Güneş Gıda',
    province: 'Antalya',
    district: 'Kepez',
    type: 'Toptan',
    territory: 'Muratpasa',
    salesRepresentative: 'Mehmet Kaya',
    phone: '0242 456 78 90',
    mobilePhone: '0532 456 78 90',
    taxNo: '2345678901',
    taxOffice: 'Muratpaşa',
    address: 'Kepez, Antalya',
    location: '',
    areaM2: '',
    balance: '7.280,50 TL',
    active: true,
  },
  {
    code: '1264',
    name: 'Emre Çelik',
    title: 'Burdur Toptan',
    province: 'Burdur',
    district: 'Merkez',
    type: 'Toptan',
    territory: 'Burdur',
    salesRepresentative: 'Elif Demir',
    phone: '0248 678 90 12',
    mobilePhone: '0544 678 90 12',
    taxNo: '3456789012',
    taxOffice: 'Burdur',
    address: 'Merkez, Burdur',
    location: '',
    areaM2: '',
    balance: '-2.140,00 TL',
    active: true,
  },
  {
    code: '1399',
    name: 'Yusuf Kale',
    title: 'Kale Bakkaliyesi',
    province: 'Antalya',
    district: 'Kepez',
    type: 'Perakende',
    territory: 'Kepez',
    salesRepresentative: 'Ahmet Yilmaz',
    phone: '0242 789 01 23',
    mobilePhone: '0566 789 01 23',
    taxNo: '4567890123',
    taxOffice: 'Kepez',
    address: 'Kepez, Antalya',
    location: '',
    areaM2: '',
    balance: '0,00 TL',
    active: true,
  },
]

const getDefaultCustomerType = (customerTypeList: CustomerTypeRow[]) =>
  customerTypeList[0]?.name ?? 'Perakende'

const initialCustomerTypes: CustomerTypeRow[] = [
  { code: 'CT-001', name: 'Distribütör' },
  { code: 'CT-002', name: 'Perakende' },
  { code: 'CT-003', name: 'Toptan' },
  { code: 'CT-004', name: 'Kurumsal' },
  { code: 'CT-005', name: 'İthalat' },
]

const initialCustomerGroups: CustomerGroupRow[] = [
  { code: 'CG-001', name: 'A Grubu' },
  { code: 'CG-002', name: 'B Grubu' },
  { code: 'CG-003', name: 'C Grubu' },
  { code: 'CG-004', name: 'Özel Müşteri' },
]

const initialChiefs: ChiefRow[] = [
  { code: 'S-001', name: 'Antalya Şefi' },
  { code: 'S-002', name: 'Burdur Şefi' },
  { code: 'S-003', name: 'İzmir Şefi' },
]

const initialRegions: RegionRow[] = [
  { code: 'BOL-01', name: 'Antalya Merkez', manager: 'Ahmet Yilmaz', description: 'Antalya merkez dağıtım bölgesi' },
  { code: 'BOL-02', name: 'Muratpaşa', manager: 'Mehmet Kaya', description: 'Muratpaşa bölgesel pazar alanı' },
  { code: 'BOL-03', name: 'Burdur Merkez', manager: 'Elif Demir', description: 'Burdur merkez satış bölgesi' },
]

const emptyForm = {
  code: '',
  name: '',
  title: '',
  province: '',
  district: '',
  type: getDefaultCustomerType(initialCustomerTypes),
  territory: '',
  salesRepresentative: '',
  phone: '',
  mobilePhone: '',
  taxNo: '',
  taxOffice: '',
  address: '',
  location: '',
  areaM2: '',
  active: true,
}

const districtsByProvince: Record<string, string[]> = {
  Antalya: ['Akseki', 'Alanya', 'Kemer', 'Kepez', 'Konyaaltı', 'Manavgat', 'Muratpaşa', 'Serik'],
  Burdur: ['Bucak', 'Gölhisar', 'Merkez', 'Tefenni'],
  İzmir: ['Bornova', 'Buca', 'Karşıyaka', 'Konak', 'Urla'],
}
const provinceOptions = Object.keys(districtsByProvince)

const emptyRegionForm = {
  code: '',
  name: '',
  manager: '',
  description: '',
}

const getNextCustomerCode = (customerList: CustomerRow[]) => {
  const numbers = customerList
    .map((customer) => Number(customer.code))
    .filter((value) => Number.isFinite(value))

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1001
  return nextNumber.toString().padStart(4, '0')
}

const getNextCustomerTypeCode = (customerTypeList: CustomerTypeRow[]) => {
  const numbers = customerTypeList
    .map((type) => {
      const match = type.code.match(/(\d+)/)
      return match ? Number(match[1]) : Number.NaN
    })
    .filter((value) => Number.isFinite(value))

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  return `CT-${nextNumber.toString().padStart(3, '0')}`
}

const getNextCustomerGroupCode = (customerGroupList: CustomerGroupRow[]) => {
  const numbers = customerGroupList
    .map((group) => {
      const match = group.code.match(/(\d+)/)
      return match ? Number(match[1]) : Number.NaN
    })
    .filter((value) => Number.isFinite(value))

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  return `CG-${nextNumber.toString().padStart(3, '0')}`
}

const getNextChiefCode = (chiefList: ChiefRow[]) => {
  const numbers = chiefList
    .map((chief) => {
      const match = chief.code.match(/(\d+)/)
      return match ? Number(match[1]) : Number.NaN
    })
    .filter((value) => Number.isFinite(value))

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  return `S-${nextNumber.toString().padStart(3, '0')}`
}

const getNextRegionCode = (regionList: RegionRow[]) => {
  const numbers = regionList
    .map((region) => {
      const match = region.code.match(/(\d+)/)
      return match ? Number(match[1]) : Number.NaN
    })
    .filter((value) => Number.isFinite(value))

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  return `BOL-${nextNumber.toString().padStart(2, '0')}`
}

export function CustomersWindow() {
  const tabs = ['Cari Kart Tanımlama', 'Cari Tip Tanımlama', 'Cari Grup Tanımlama', 'Şef Tanımlama', 'Cari Bölge Tanımlama']
  const [activeTab, setActiveTab] = useState(tabs[0])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [hoveredCustomer, setHoveredCustomer] = useState<CustomerRow | null>(null)
  const customerHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerTypes, setCustomerTypes] = useState<CustomerTypeRow[]>([])
  const [customerGroups, setCustomerGroups] = useState<CustomerGroupRow[]>([])
  const [chiefs, setChiefs] = useState<ChiefRow[]>([])
  const [regions, setRegions] = useState<RegionRow[]>([])
  const [form, setForm] = useState(() => ({ ...emptyForm, code: getNextCustomerCode(initialCustomers) }))
  const [regionForm, setRegionForm] = useState({ ...emptyRegionForm, code: getNextRegionCode(initialRegions) })
  const [customerTypeForm, setCustomerTypeForm] = useState({ code: getNextCustomerTypeCode(initialCustomerTypes), name: '' })
  const [customerGroupForm, setCustomerGroupForm] = useState({ code: getNextCustomerGroupCode(initialCustomerGroups), name: '' })
  const [chiefForm, setChiefForm] = useState({ code: getNextChiefCode(initialChiefs), name: '' })
  const [showCustomerTypeForm, setShowCustomerTypeForm] = useState(false)
  const [showCustomerGroupForm, setShowCustomerGroupForm] = useState(false)
  const [showChiefForm, setShowChiefForm] = useState(false)
  const [showRegionForm, setShowRegionForm] = useState(false)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editingCustomerTypeCode, setEditingCustomerTypeCode] = useState<string | null>(null)
  const [editingCustomerGroupCode, setEditingCustomerGroupCode] = useState<string | null>(null)
  const [editingChiefCode, setEditingChiefCode] = useState<string | null>(null)
  const [editingRegionCode, setEditingRegionCode] = useState<string | null>(null)
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const [masterDataAccess, setMasterDataAccess] = useState<Record<string, { visible: boolean; actions: { view: boolean; create: boolean; edit: boolean; delete: boolean } }>>({})
  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('vdesgo-user') || '{}') as { username?: string; accountType?: string } } catch { return {} }
  })()
  const isDistributor = currentUser.accountType === 'distributor'
  const authHeaders: Record<string, string> = {
    'x-vdesgo-account-type': currentUser.accountType || '',
    'x-vdesgo-username': currentUser.username || '',
  }
  const tabAccessKey: Record<string, string> = {
    'Cari Tip Tanımlama': 'CustomerTypeDefinition',
    'Cari Grup Tanımlama': 'CustomerGroupDefinition',
    'Şef Tanımlama': 'ChiefDefinition',
    'Cari Bölge Tanımlama': 'CustomerRegionDefinition',
  }
  const activeMasterAccess = tabAccessKey[activeTab] ? masterDataAccess[tabAccessKey[activeTab]] : undefined
  const canManageMasterData = !isDistributor || Boolean(activeMasterAccess?.actions?.create || activeMasterAccess?.actions?.edit || activeMasterAccess?.actions?.delete)
  const isMasterDataReadOnly = Boolean(tabAccessKey[activeTab]) && !canManageMasterData

  const customerTypeOptions = customerTypes.map((type) => type.name)
  const regionOptions = regions.map((region) => region.name)
  const chiefOptions = chiefs.map((chief) => chief.name)
  const districtOptions = districtsByProvince[form.province] ?? []
  const filteredCustomers = customers.filter((customer) => {
    const searchText = customerSearch.trim().toLocaleLowerCase('tr-TR')
    if (!searchText) return true
    return [customer.code, customer.name, customer.title, customer.province, customer.district, customer.address, customer.location, customer.phone, customer.mobilePhone, customer.taxNo]
      .some((value) => value.toLocaleLowerCase('tr-TR').includes(searchText))
  })
  const startCustomerHover = (customer: CustomerRow) => {
    if (customerHoverTimer.current) clearTimeout(customerHoverTimer.current)
    setHoveredCustomer(null)
    customerHoverTimer.current = setTimeout(() => setHoveredCustomer(customer), 1000)
  }
  const clearCustomerHover = () => {
    if (customerHoverTimer.current) clearTimeout(customerHoverTimer.current)
    customerHoverTimer.current = null
    setHoveredCustomer(null)
  }

  useEffect(() => {
    if (!customerTypeOptions.includes(form.type)) {
      setForm((current) => ({
        ...current,
        type: getDefaultCustomerType(customerTypes),
      }))
    }

    if (regionOptions.length > 0 && !regionOptions.includes(form.territory)) {
      setForm((current) => ({
        ...current,
        territory: current.territory || regionOptions[0],
      }))
    }

    if (chiefOptions.length > 0 && !chiefOptions.includes(form.salesRepresentative)) {
      setForm((current) => ({
        ...current,
        salesRepresentative: current.salesRepresentative || chiefOptions[0],
      }))
    }

    if (chiefOptions.length > 0 && !chiefOptions.includes(regionForm.manager)) {
      setRegionForm((current) => ({
        ...current,
        manager: current.manager || chiefOptions[0],
      }))
    }
  }, [customerTypeOptions, customerTypes, form.type, regionOptions, form.territory, chiefOptions, form.salesRepresentative, regionForm.manager])

  useEffect(() => {
    const load = async () => {
      try {
        const [customerData, typeData, groupData, chiefData, regionData] = await Promise.all([
          fetch(`${apiUrl}/data/customers`, { headers: authHeaders }).then((response) => response.json()),
          fetch(`${apiUrl}/data/customerTypes`, { headers: authHeaders }).then((response) => response.json()),
          fetch(`${apiUrl}/data/customerGroups`, { headers: authHeaders }).then((response) => response.json()),
          fetch(`${apiUrl}/data/chiefs`, { headers: authHeaders }).then((response) => response.json()),
          fetch(`${apiUrl}/data/regions`, { headers: authHeaders }).then((response) => response.json()),
        ])
        if (Array.isArray(customerData)) setCustomers(customerData)
        if (Array.isArray(typeData)) setCustomerTypes(typeData)
        if (Array.isArray(groupData)) setCustomerGroups(groupData)
        if (Array.isArray(chiefData)) setChiefs(chiefData)
        if (Array.isArray(regionData)) setRegions(regionData)
      } catch {
        window.alert('Cari tanım kayıtları veritabanından alınamadı.')
      }
    }
    void load()
  }, [apiUrl, currentUser.accountType, currentUser.username])

  useEffect(() => {
    if (!isDistributor || !currentUser.username) return
    fetch(`${apiUrl}/security/access-matrix/${encodeURIComponent(currentUser.username)}`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((permissions) => setMasterDataAccess(permissions))
      .catch(() => setMasterDataAccess({}))
  }, [apiUrl, currentUser.username, isDistributor])

  const saveResource = async <T extends { code: string }>(resource: string, item: T, existingCode?: string) => {
    const response = await fetch(`${apiUrl}/data/${resource}${existingCode ? `/${encodeURIComponent(existingCode)}` : ''}`, {
      method: existingCode ? 'PUT' : 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
    if (!response.ok) {
      let message = 'Kayıt işlemi tamamlanamadı.'
      try { message = (await response.json()).error || message } catch { /* keep generic message */ }
      throw new Error(message)
    }
    return response.json() as Promise<T>
  }

  const deleteResource = async (resource: string, code: string) => {
    const response = await fetch(`${apiUrl}/data/${resource}/${encodeURIComponent(code)}`, { method: 'DELETE', headers: authHeaders })
    if (!response.ok) {
      let message = 'Silme işlemi tamamlanamadı.'
      try { message = (await response.json()).error || message } catch { /* keep generic message */ }
      throw new Error(message)
    }
  }

  const updateField = (field: keyof typeof emptyForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const updateCustomerTypeField = (field: 'code' | 'name', value: string) => {
    setCustomerTypeForm((current) => ({ ...current, [field]: value }))
  }

  const updateCustomerGroupField = (field: 'code' | 'name', value: string) => {
    setCustomerGroupForm((current) => ({ ...current, [field]: value }))
  }

  const updateChiefField = (field: 'code' | 'name', value: string) => {
    setChiefForm((current) => ({ ...current, [field]: value }))
  }

  const resetForm = () => {
    setForm({
      ...emptyForm,
      code: getNextCustomerCode(customers),
      type: getDefaultCustomerType(customerTypes),
      territory: regionOptions[0] ?? '',
      salesRepresentative: chiefOptions[0] ?? '',
    })
    setEditingCode(null)
    setShowCustomerForm(false)
  }

  const toggleCustomerForm = () => {
    if (showCustomerForm) {
      resetForm()
      return
    }

    setEditingCode(null)
    setForm({
      ...emptyForm,
      code: getNextCustomerCode(customers),
      type: getDefaultCustomerType(customerTypes),
      territory: regionOptions[0] ?? '',
      salesRepresentative: chiefOptions[0] ?? '',
    })
    setShowCustomerForm(true)
  }

  const updateRegionField = (field: keyof typeof emptyRegionForm, value: string) => {
    setRegionForm((current) => ({ ...current, [field]: value }))
  }

  const resetRegionForm = () => {
    setRegionForm({
      code: getNextRegionCode(regions),
      name: '',
      manager: chiefOptions[0] ?? '',
      description: '',
    })
    setEditingRegionCode(null)
    setShowRegionForm(false)
  }

  const toggleRegionForm = (region?: RegionRow) => {
    if (showRegionForm && !region && !editingRegionCode) {
      resetRegionForm()
      return
    }

    if (region) {
      setEditingRegionCode(region.code)
      setRegionForm({
        code: region.code,
        name: region.name,
        manager: region.manager,
        description: region.description,
      })
      setShowRegionForm(true)
      return
    }

    if (showRegionForm) {
      resetRegionForm()
      return
    }

    setEditingRegionCode(null)
    setRegionForm({
      code: getNextRegionCode(regions),
      name: '',
      manager: chiefOptions[0] ?? '',
      description: '',
    })
    setShowRegionForm(true)
  }

  const addRegion = async () => {
    const trimmedName = regionForm.name.trim()
    const trimmedManager = regionForm.manager.trim()
    if (!trimmedName || !trimmedManager) return

    const nextCode = editingRegionCode ? regionForm.code.trim() || editingRegionCode : getNextRegionCode(regions)
    try {
      const saved = await saveResource('regions', { code: nextCode, name: trimmedName, manager: trimmedManager, description: regionForm.description.trim() }, editingRegionCode ?? undefined)
      setRegions((current) => editingRegionCode ? current.map((region) => region.code === editingRegionCode ? saved : region) : [...current, saved])
    } catch { return window.alert('Bölge kaydedilemedi.') }

    resetRegionForm()
  }

  const startEditRegion = (region: RegionRow) => {
    const confirmed = window.confirm(`${region.name} adlı bölge tanımını düzenlemek istediğinize emin misiniz?`)
    if (!confirmed) return

    toggleRegionForm(region)
  }

  const deleteRegion = async (code: string) => {
    const target = regions.find((region) => region.code === code)
    if (!target) return

    const confirmed = window.confirm(`${target.name} adlı bölge tanımını silmek istediğinize emin misiniz?`)
    if (!confirmed) return

    try { await deleteResource('regions', code) } catch { return window.alert('Bölge silinemedi.') }
    setRegions((current) => current.filter((region) => region.code !== code))

    if (editingRegionCode === code) {
      resetRegionForm()
    }
  }

  const resetCustomerTypeForm = () => {
    setCustomerTypeForm({
      code: getNextCustomerTypeCode(customerTypes),
      name: '',
    })
    setEditingCustomerTypeCode(null)
    setShowCustomerTypeForm(false)
  }

  const toggleCustomerTypeForm = (customerType?: CustomerTypeRow) => {
    if (showCustomerTypeForm && !customerType && !editingCustomerTypeCode) {
      resetCustomerTypeForm()
      return
    }

    if (customerType) {
      setEditingCustomerTypeCode(customerType.code)
      setCustomerTypeForm({
        code: customerType.code,
        name: customerType.name,
      })
      setShowCustomerTypeForm(true)
      return
    }

    if (showCustomerTypeForm) {
      resetCustomerTypeForm()
      return
    }

    setEditingCustomerTypeCode(null)
    setCustomerTypeForm({
      code: getNextCustomerTypeCode(customerTypes),
      name: '',
    })
    setShowCustomerTypeForm(true)
  }

  const openCustomerTypeForm = (customerType?: CustomerTypeRow) => {
    if (customerType) {
      setEditingCustomerTypeCode(customerType.code)
      setCustomerTypeForm({
        code: customerType.code,
        name: customerType.name,
      })
    } else {
      setEditingCustomerTypeCode(null)
      setCustomerTypeForm({
        code: getNextCustomerTypeCode(customerTypes),
        name: '',
      })
    }

    setShowCustomerTypeForm(true)
  }

  const addCustomerType = async () => {
    const trimmedName = customerTypeForm.name.trim()
    if (!trimmedName) return

    const nextCode = editingCustomerTypeCode ? customerTypeForm.code.trim() || editingCustomerTypeCode : getNextCustomerTypeCode(customerTypes)
    try {
      const saved = await saveResource('customerTypes', { code: nextCode, name: trimmedName }, editingCustomerTypeCode ?? undefined)
      setCustomerTypes((current) => editingCustomerTypeCode ? current.map((type) => type.code === editingCustomerTypeCode ? saved : type) : [...current, saved])
    } catch { return window.alert('Cari tipi kaydedilemedi.') }

    resetCustomerTypeForm()
  }

  const resetCustomerGroupForm = () => {
    setCustomerGroupForm({
      code: getNextCustomerGroupCode(customerGroups),
      name: '',
    })
    setEditingCustomerGroupCode(null)
    setShowCustomerGroupForm(false)
  }

  const toggleCustomerGroupForm = (customerGroup?: CustomerGroupRow) => {
    if (showCustomerGroupForm && !customerGroup && !editingCustomerGroupCode) {
      resetCustomerGroupForm()
      return
    }

    if (customerGroup) {
      setEditingCustomerGroupCode(customerGroup.code)
      setCustomerGroupForm({
        code: customerGroup.code,
        name: customerGroup.name,
      })
      setShowCustomerGroupForm(true)
      return
    }

    if (showCustomerGroupForm) {
      resetCustomerGroupForm()
      return
    }

    setEditingCustomerGroupCode(null)
    setCustomerGroupForm({
      code: getNextCustomerGroupCode(customerGroups),
      name: '',
    })
    setShowCustomerGroupForm(true)
  }

  const addCustomerGroup = async () => {
    const trimmedName = customerGroupForm.name.trim()
    if (!trimmedName) return

    const nextCode = editingCustomerGroupCode ? customerGroupForm.code.trim() || editingCustomerGroupCode : getNextCustomerGroupCode(customerGroups)
    try {
      const saved = await saveResource('customerGroups', { code: nextCode, name: trimmedName }, editingCustomerGroupCode ?? undefined)
      setCustomerGroups((current) => editingCustomerGroupCode ? current.map((group) => group.code === editingCustomerGroupCode ? saved : group) : [...current, saved])
    } catch { return window.alert('Cari grubu kaydedilemedi.') }

    resetCustomerGroupForm()
  }

  const startEditCustomerType = (customerType: CustomerTypeRow) => {
    const confirmed = window.confirm(`${customerType.name} adlı cari tipini düzenlemek istediğinize emin misiniz?`)
    if (!confirmed) return

    openCustomerTypeForm(customerType)
  }

  const deleteCustomerType = async (code: string) => {
    const target = customerTypes.find((type) => type.code === code)
    if (!target) return

    const confirmed = window.confirm(`${target.name} adlı cari tipini silmek istediğinize emin misiniz?`)
    if (!confirmed) return

    try { await deleteResource('customerTypes', code) } catch { return window.alert('Cari tipi silinemedi.') }
    setCustomerTypes((current) => current.filter((type) => type.code !== code))

    if (editingCustomerTypeCode === code) {
      resetCustomerTypeForm()
    }
  }

  const startEditCustomerGroup = (customerGroup: CustomerGroupRow) => {
    const confirmed = window.confirm(`${customerGroup.name} adlı cari grup tanımını düzenlemek istediğinize emin misiniz?`)
    if (!confirmed) return

    toggleCustomerGroupForm(customerGroup)
  }

  const deleteCustomerGroup = async (code: string) => {
    const target = customerGroups.find((group) => group.code === code)
    if (!target) return

    const confirmed = window.confirm(`${target.name} adlı cari grup tanımını silmek istediğinize emin misiniz?`)
    if (!confirmed) return

    try { await deleteResource('customerGroups', code) } catch { return window.alert('Cari grubu silinemedi.') }
    setCustomerGroups((current) => current.filter((group) => group.code !== code))

    if (editingCustomerGroupCode === code) {
      resetCustomerGroupForm()
    }
  }

  const resetChiefForm = () => {
    setChiefForm({
      code: getNextChiefCode(chiefs),
      name: '',
    })
    setEditingChiefCode(null)
    setShowChiefForm(false)
  }

  const toggleChiefForm = (chief?: ChiefRow) => {
    if (showChiefForm && !chief && !editingChiefCode) {
      resetChiefForm()
      return
    }

    if (chief) {
      setEditingChiefCode(chief.code)
      setChiefForm({
        code: chief.code,
        name: chief.name,
      })
      setShowChiefForm(true)
      return
    }

    if (showChiefForm) {
      resetChiefForm()
      return
    }

    setEditingChiefCode(null)
    setChiefForm({
      code: getNextChiefCode(chiefs),
      name: '',
    })
    setShowChiefForm(true)
  }

  const addChief = async () => {
    const trimmedName = chiefForm.name.trim()
    if (!trimmedName) return

    const nextCode = editingChiefCode ? chiefForm.code.trim() || editingChiefCode : getNextChiefCode(chiefs)
    try {
      const saved = await saveResource('chiefs', { code: nextCode, name: trimmedName }, editingChiefCode ?? undefined)
      setChiefs((current) => editingChiefCode ? current.map((chief) => chief.code === editingChiefCode ? saved : chief) : [...current, saved])
    } catch { return window.alert('Şef kaydedilemedi.') }

    resetChiefForm()
  }

  const startEditChief = (chief: ChiefRow) => {
    const confirmed = window.confirm(`${chief.name} adlı şefi düzenlemek istediğinize emin misiniz?`)
    if (!confirmed) return

    toggleChiefForm(chief)
  }

  const deleteChief = async (code: string) => {
    const target = chiefs.find((chief) => chief.code === code)
    if (!target) return

    const confirmed = window.confirm(`${target.name} adlı şefi silmek istediğinize emin misiniz?`)
    if (!confirmed) return

    try { await deleteResource('chiefs', code) } catch { return window.alert('Şef silinemedi.') }
    setChiefs((current) => current.filter((chief) => chief.code !== code))

    if (editingChiefCode === code) {
      resetChiefForm()
    }
  }

  const addCustomer = async () => {
    const nextCode = getNextCustomerCode(customers)
    if (!form.name.trim() || !form.territory.trim()) return

    const customer = { ...form, code: form.code.trim() || nextCode, name: form.name.trim(), title: form.title.trim(), territory: form.territory.trim(), salesRepresentative: form.salesRepresentative.trim() || 'Atanmadı', phone: form.phone.trim(), mobilePhone: form.mobilePhone.trim(), taxNo: form.taxNo.trim(), taxOffice: form.taxOffice.trim(), address: form.address.trim(), balance: '0,00 TL' }
    try { const saved = await saveResource('customers', customer); setCustomers((current) => [...current, saved]) } catch { return window.alert('Cari kart kaydedilemedi.') }

    resetForm()
  }

  const startEdit = (customer: CustomerRow) => {
    const confirmed = window.confirm(`${customer.name} cari kartını düzenlemek istediğinize emin misiniz?`)
    if (!confirmed) return

    setEditingCode(customer.code)
    setForm({
      code: customer.code,
      name: customer.name,
      title: customer.title,
      province: customer.province,
      district: customer.district,
      type: customer.type,
      territory: customer.territory,
      salesRepresentative: customer.salesRepresentative,
      phone: customer.phone,
      mobilePhone: customer.mobilePhone,
      taxNo: customer.taxNo,
      taxOffice: customer.taxOffice,
      address: customer.address,
      location: customer.location,
      areaM2: customer.areaM2,
      active: customer.active,
    })
    setShowCustomerForm(true)
  }

  const saveEdit = async () => {
    if (!editingCode) return

    const trimmedName = form.name.trim()
    const trimmedTerritory = form.territory.trim()

    if (!trimmedName || !trimmedTerritory) return

    const existing = customers.find((customer) => customer.code === editingCode)
    if (!existing) return
    const customer = { ...existing, name: trimmedName, title: form.title.trim(), type: form.type, territory: trimmedTerritory, salesRepresentative: form.salesRepresentative.trim() || existing.salesRepresentative, phone: form.phone.trim(), mobilePhone: form.mobilePhone.trim(), taxNo: form.taxNo.trim(), taxOffice: form.taxOffice.trim(), address: form.address.trim(), active: form.active }
    try { const saved = await saveResource('customers', customer, editingCode); setCustomers((current) => current.map((item) => item.code === editingCode ? saved : item)) } catch { return window.alert('Cari kart güncellenemedi.') }

    resetForm()
  }

  const deleteCustomer = async (code: string) => {
    const target = customers.find((customer) => customer.code === code)
    if (!target) return

    const confirmed = window.confirm(`${target.name} adlı cari kartı silmek istediğinize emin misiniz?`)
    if (!confirmed) return

    try { await deleteResource('customers', code) } catch { return window.alert('Cari kart silinemedi.') }
    setCustomers((current) => current.filter((customer) => customer.code !== code))

    if (editingCode === code) {
      resetForm()
    }
  }

  return (
    <div className="customers-window" style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: '1rem', minHeight: '100%', height: '100%' }}>
      <aside aria-label="Cari tanımlama menüsü" style={{ borderRight: '1px solid #d8d8d8', paddingRight: '0.75rem', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab}
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                textAlign: 'left',
                padding: '0.65rem 0.75rem',
                border: activeTab === tab ? '1px solid #1d4ed8' : '1px solid transparent',
                borderRadius: '6px',
                background: activeTab === tab ? '#e8f0ff' : '#f5f5f5',
                color: '#1f2937',
                fontWeight: activeTab === tab ? 600 : 500,
                cursor: 'pointer',
              }}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
      </aside>

      <div className={isMasterDataReadOnly ? 'master-data-readonly' : ''} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
        {activeTab === 'Şef Tanımlama' && (
          <>
            <section className="warehouse-list-panel" aria-label="Şef listesi" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0, flex: 1, maxHeight: '500px', overflow: 'hidden' }}>
              <div className="customers-toolbar" style={{ marginBottom: '0.75rem', width: '100%' }}>
                <div>
                  <strong>Şefler</strong>
                  <span>{chiefs.length} kayıt</span>
                </div>
                <button className="primary-action" onClick={() => toggleChiefForm()} type="button" style={{ marginTop: 0 }}>
                  Yeni
                </button>
              </div>

              {showChiefForm && (
                <section className="definition-form-panel" aria-label="Şef tanımlama formu" style={{ paddingBottom: '0.75rem' }}>
                  <div className="definition-panel-heading">
                    <div>
                      <p className="definition-kicker">ŞEF TANIMLAMA</p>
                      <h2>{editingChiefCode ? 'Şef Düzenleme' : 'Yeni Şef'}</h2>
                    </div>
                    <span className="mock-badge">MERKEZ</span>
                  </div>

                  <div className="warehouse-form-grid">
                    <label>
                      Kodu
                      <input value={chiefForm.code} readOnly disabled />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Adı
                      <input
                        value={chiefForm.name}
                        onChange={(event) => updateChiefField('name', event.target.value)}
                        placeholder="Antalya Şefi"
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="ghost-button" onClick={resetChiefForm} type="button">İptal</button>
                    <button className="primary-action" onClick={addChief} type="button">
                      {editingChiefCode ? 'Düzenle' : 'Kaydet'}
                    </button>
                  </div>
                </section>
              )}

              <div className="customers-table-wrap" style={{ maxHeight: '320px', width: '100%', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="customers-table">
                  <thead>
                    <tr>
                      <th>Kod</th>
                      <th>Ad</th>
                      <th style={{ width: '180px' }}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chiefs.map((chief) => (
                      <tr key={chief.code} onDoubleClick={() => startEditChief(chief)} style={{ cursor: 'pointer' }}>
                        <td className="customer-code">{chief.code}</td>
                        <td>{chief.name}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="ghost-button" onClick={() => startEditChief(chief)} type="button">Düzenle</button>
                            <button className="danger-button" onClick={() => deleteChief(chief.code)} type="button">Sil</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'Cari Bölge Tanımlama' && (
          <>
            <section className="warehouse-list-panel" aria-label="Bölgeler listesi" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0, flex: 1, maxHeight: '500px', overflow: 'hidden' }}>
              <div className="customers-toolbar" style={{ marginBottom: '0.75rem', width: '100%' }}>
                <div>
                  <strong>Bölgeler</strong>
                  <span>{regions.length} kayıt</span>
                </div>
                <button className="primary-action" onClick={() => toggleRegionForm()} type="button" style={{ marginTop: 0 }}>
                  Yeni
                </button>
              </div>

              {showRegionForm && (
                <section className="definition-form-panel" aria-label="Bölge tanımlama formu" style={{ paddingBottom: '0.75rem' }}>
                  <div className="definition-panel-heading">
                    <div>
                      <p className="definition-kicker">BÖLGE TANIMLAMA</p>
                      <h2>{editingRegionCode ? 'Bölge Düzenleme' : 'Yeni Bölge'}</h2>
                    </div>
                    <span className="mock-badge">MERKEZ</span>
                  </div>

                  <div className="warehouse-form-grid">
                    <label>
                      Kodu
                      <input value={regionForm.code} readOnly disabled />
                    </label>
                    <label>
                      Bölge Adı
                      <input value={regionForm.name} onChange={(event) => updateRegionField('name', event.target.value)} placeholder="Antalya Merkez" />
                    </label>
                    <label>
                      Bölge Şefi
                      <select value={regionForm.manager} onChange={(event) => updateRegionField('manager', event.target.value)}>
                        {chiefOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Bölge Tanım Alanı
                      <input value={regionForm.description} onChange={(event) => updateRegionField('description', event.target.value)} placeholder="Antalya merkez dağıtım bölgesi" />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="ghost-button" onClick={resetRegionForm} type="button">İptal</button>
                    <button className="primary-action" onClick={addRegion} type="button">
                      {editingRegionCode ? 'Düzenle' : 'Kaydet'}
                    </button>
                  </div>
                </section>
              )}

              <div className="customers-table-wrap" style={{ maxHeight: '320px', width: '100%', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="customers-table">
                  <thead>
                    <tr>
                      <th>Kod</th>
                      <th>Bölge Adı</th>
                      <th>Bölge Şefi</th>
                      <th>Bölge Tanım Alanı</th>
                      <th style={{ width: '180px' }}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regions.map((region) => (
                      <tr key={region.code} onDoubleClick={() => startEditRegion(region)} style={{ cursor: 'pointer' }}>
                        <td className="customer-code">{region.code}</td>
                        <td>{region.name}</td>
                        <td>{region.manager}</td>
                        <td>{region.description}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="ghost-button" onClick={() => startEditRegion(region)} type="button">Düzenle</button>
                            <button className="danger-button" onClick={() => deleteRegion(region.code)} type="button">Sil</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'Cari Tip Tanımlama' && (
          <>
            <section className="warehouse-list-panel" aria-label="Cari tip listesi" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0, flex: 1, maxHeight: '500px', overflow: 'hidden' }}>
              <div className="customers-toolbar" style={{ marginBottom: '0.75rem', width: '100%' }}>
                <div>
                  <strong>Cari Tipleri</strong>
                  <span>{customerTypes.length} kayıt</span>
                </div>
                <button className="primary-action" onClick={() => toggleCustomerTypeForm()} type="button" style={{ marginTop: 0 }}>
                  Yeni
                </button>
              </div>

              {showCustomerTypeForm && (
                <section className="definition-form-panel" aria-label="Cari tip tanımlama formu" style={{ paddingBottom: '0.75rem' }}>
                  <div className="definition-panel-heading">
                    <div>
                      <p className="definition-kicker">CARI TİP</p>
                      <h2>{editingCustomerTypeCode ? 'Cari Tip Düzenleme' : 'Yeni Cari Tip'}</h2>
                    </div>
                    <span className="mock-badge">MERKEZ</span>
                  </div>

                  <div className="warehouse-form-grid">
                    <label>
                      Cari Tip Kodu
                      <input value={customerTypeForm.code} readOnly disabled />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Cari Tip Adı
                      <input
                        value={customerTypeForm.name}
                        onChange={(event) => updateCustomerTypeField('name', event.target.value)}
                        placeholder="Distribütör"
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="ghost-button" onClick={resetCustomerTypeForm} type="button">İptal</button>
                    <button className="primary-action" onClick={addCustomerType} type="button">
                      {editingCustomerTypeCode ? 'Düzenle' : 'Kaydet'}
                    </button>
                  </div>
                </section>
              )}

              <div className="customers-table-wrap" style={{ maxHeight: '320px', width: '100%', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="customers-table">
                  <thead>
                    <tr>
                      <th>Kod</th>
                      <th>Ad</th>
                      <th style={{ width: '180px' }}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerTypes.map((customerType) => (
                      <tr key={customerType.code} onDoubleClick={() => startEditCustomerType(customerType)} style={{ cursor: 'pointer' }}>
                        <td className="customer-code">{customerType.code}</td>
                        <td>{customerType.name}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="ghost-button" onClick={() => startEditCustomerType(customerType)} type="button">Düzenle</button>
                            <button className="danger-button" onClick={() => deleteCustomerType(customerType.code)} type="button">Sil</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'Cari Grup Tanımlama' && (
          <>
            <section className="warehouse-list-panel" aria-label="Cari grup listesi" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0, flex: 1, maxHeight: '500px', overflow: 'hidden' }}>
              <div className="customers-toolbar" style={{ marginBottom: '0.75rem', width: '100%' }}>
                <div>
                  <strong>Cari Grup Tanımları</strong>
                  <span>{customerGroups.length} kayıt</span>
                </div>
                <button className="primary-action" onClick={() => toggleCustomerGroupForm()} type="button" style={{ marginTop: 0 }}>
                  Yeni
                </button>
              </div>

              {showCustomerGroupForm && (
                <section className="definition-form-panel" aria-label="Cari grup tanımlama formu" style={{ paddingBottom: '0.75rem' }}>
                  <div className="definition-panel-heading">
                    <div>
                      <p className="definition-kicker">CARI GRUP</p>
                      <h2>{editingCustomerGroupCode ? 'Cari Grup Düzenleme' : 'Yeni Cari Grup'}</h2>
                    </div>
                    <span className="mock-badge">MERKEZ</span>
                  </div>

                  <div className="warehouse-form-grid">
                    <label>
                      Cari Grup Kodu
                      <input value={customerGroupForm.code} readOnly disabled />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Cari Grup Adı
                      <input
                        value={customerGroupForm.name}
                        onChange={(event) => updateCustomerGroupField('name', event.target.value)}
                        placeholder="A Grubu"
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="ghost-button" onClick={resetCustomerGroupForm} type="button">İptal</button>
                    <button className="primary-action" onClick={addCustomerGroup} type="button">
                      {editingCustomerGroupCode ? 'Düzenle' : 'Kaydet'}
                    </button>
                  </div>
                </section>
              )}

              <div className="customers-table-wrap" style={{ maxHeight: '320px', width: '100%', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="customers-table">
                  <thead>
                    <tr>
                      <th>Kod</th>
                      <th>Ad</th>
                      <th style={{ width: '180px' }}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerGroups.map((customerGroup) => (
                      <tr key={customerGroup.code} onDoubleClick={() => startEditCustomerGroup(customerGroup)} style={{ cursor: 'pointer' }}>
                        <td className="customer-code">{customerGroup.code}</td>
                        <td>{customerGroup.name}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="ghost-button" onClick={() => startEditCustomerGroup(customerGroup)} type="button">Düzenle</button>
                            <button className="danger-button" onClick={() => deleteCustomerGroup(customerGroup.code)} type="button">Sil</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'Cari Kart Tanımlama' && (
          <>
            <section className="warehouse-list-panel" aria-label="Cari kart listesi" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0, flex: 1, maxHeight: '500px', overflow: 'hidden' }}>
              <div className="customers-toolbar" style={{ marginBottom: '0.75rem', width: '100%' }}>
                <div>
                  <strong>Müşteri Listesi</strong>
                  <span>{customers.length} kayıt</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <label>
                    <span className="sr-only">Müşteri ara</span>
                    <input aria-label="Müşteri ara" onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Müşteri ara..." type="search" value={customerSearch} />
                  </label>
                  <button className="primary-action" onClick={toggleCustomerForm} type="button" style={{ marginTop: 0 }}>
                    Yeni
                  </button>
                </div>
              </div>

              {showCustomerForm && (
                <section className="definition-form-panel" aria-label="Cari kart formu" style={{ paddingBottom: '0.75rem' }}>
                  <div className="definition-panel-heading">
                    <div>
                      <p className="definition-kicker">CARI KARTI</p>
                      <h2>{editingCode ? 'Cari Kart Düzenleme' : 'Yeni Cari Kart'}</h2>
                    </div>
                    <span className="mock-badge">MERKEZ · DİSTRİBÜTÖR</span>
                  </div>

                  <div className="warehouse-form-grid">
                    <label>
                      Cari Kodu
                      <input value={form.code} placeholder="0001" readOnly disabled />
                    </label>
                    <label>
                      Yetkili Adı
                      <input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Yetkili adı" />
                    </label>
                    <label>
                      Cari Ünvanı
                      <input value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder="ABC Market" />
                    </label>
                    <label>
                      İl
                      <select value={form.province} onChange={(event) => { updateField('province', event.target.value); updateField('district', '') }}>
                        <option value="">İl seçiniz</option>
                        {provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}
                      </select>
                    </label>
                    <label>
                      İlçe
                      <select value={form.district} onChange={(event) => updateField('district', event.target.value)}>
                        <option value="">İlçe seçiniz</option>
                        {districtOptions.map((district) => <option key={district} value={district}>{district}</option>)}
                      </select>
                    </label>
                    <label>
                      Cari Tipi
                      <select value={form.type} onChange={(event) => updateField('type', event.target.value)}>
                        {customerTypeOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Durum
                      <select value={form.active ? 'active' : 'passive'} onChange={(event) => updateField('active', event.target.value === 'active')}>
                        <option value="active">Aktif</option>
                        <option value="passive">Pasif</option>
                      </select>
                    </label>
                    <label>
                      Bölge
                      <select value={form.territory} onChange={(event) => updateField('territory', event.target.value)}>
                        {regionOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Batı Şefi
                      <select value={form.salesRepresentative} onChange={(event) => updateField('salesRepresentative', event.target.value)}>
                        {chiefOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Telefon
                      <input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="0242 123 45 67" />
                    </label>
                    <label>
                      Cep Telefonu
                      <input value={form.mobilePhone} onChange={(event) => updateField('mobilePhone', event.target.value)} placeholder="0555 123 45 67" />
                    </label>
                    <label>
                      Vergi No / Ticaret Sicil No
                      <input value={form.taxNo} onChange={(event) => updateField('taxNo', event.target.value)} placeholder="1234567890" />
                    </label>
                    <label>
                      Vergi Dairesi
                      <input value={form.taxOffice} onChange={(event) => updateField('taxOffice', event.target.value)} placeholder="Antalya" />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Adres
                      <input value={form.address} onChange={(event) => updateField('address', event.target.value)} placeholder="Adres bilgisi" />
                    </label>
                    <label>
                      Konum
                      <input value={form.location} onChange={(event) => updateField('location', event.target.value)} placeholder="Harita konumu veya koordinat" />
                    </label>
                    <label>
                      Alan (M²)
                      <input inputMode="decimal" min="0" type="number" value={form.areaM2} onChange={(event) => updateField('areaM2', event.target.value)} placeholder="0" />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="ghost-button" onClick={resetForm} type="button">İptal</button>
                    <button className="primary-action" onClick={editingCode ? saveEdit : addCustomer} type="button">
                      {editingCode ? 'Düzenle' : 'Kaydet'}
                    </button>
                  </div>
                </section>
              )}

              <div className="customers-table-wrap" style={{ maxHeight: '320px', width: '100%', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="customers-table">
                  <thead>
                    <tr>
                      <th scope="col">Müşteri Kodu</th>
                      <th scope="col">Müşteri Adı</th>
                      <th scope="col">İl</th>
                      <th scope="col">İlçe</th>
                      <th scope="col">Adres</th>
                      <th scope="col">Konum</th>
                      <th scope="col">M²</th>
                      <th scope="col">Tip</th>
                      <th scope="col">Bölge</th>
                      <th scope="col">Batı Şefi</th>
                      <th scope="col">Bakiye</th>
                      <th scope="col">Durum</th>
                      <th scope="col" style={{ width: '180px' }}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((customer) => (
                      <tr className={customer.active ? '' : 'customer-inactive'} key={customer.code} onDoubleClick={() => startEdit(customer)} onMouseEnter={() => startCustomerHover(customer)} onMouseLeave={clearCustomerHover} style={{ cursor: 'pointer' }}>
                        <td className="customer-code">{customer.code}</td>
                        <td>{customer.name}</td>
                        <td>{customer.province || '-'}</td>
                        <td>{customer.district || '-'}</td>
                        <td>{customer.address || '-'}</td>
                        <td>{customer.location || '-'}</td>
                        <td>{customer.areaM2 || '-'}</td>
                        <td>{customer.type}</td>
                        <td>{customer.territory}</td>
                        <td>{customer.salesRepresentative}</td>
                        <td className={customer.balance.startsWith('-') ? 'balance-negative' : 'balance-positive'}>
                          {customer.balance}
                        </td>
                        <td>{customer.active ? 'Aktif' : 'Pasif'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="ghost-button" onClick={() => startEdit(customer)} type="button">Düzenle</button>
                            <button className="danger-button" onClick={() => deleteCustomer(customer.code)} type="button">Sil</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
      {hoveredCustomer && (
        <div className="customer-hover-toast" role="status">
          <strong>{hoveredCustomer.name} · {hoveredCustomer.title}</strong>
          <div className="customer-hover-toast-details">
            <span><b>Kod:</b> {hoveredCustomer.code}</span>
            <span><b>Durum:</b> {hoveredCustomer.active ? 'Aktif' : 'Pasif'}</span>
            <span><b>İl / İlçe:</b> {hoveredCustomer.province || '-'} / {hoveredCustomer.district || '-'}</span>
            <span><b>Tip:</b> {hoveredCustomer.type || '-'}</span>
            <span><b>Cari Grup:</b> {hoveredCustomer.customerGroupCode || '-'}</span>
            <span><b>Bölge:</b> {hoveredCustomer.territory || '-'}</span>
            <span><b>Şef:</b> {hoveredCustomer.salesRepresentative || '-'}</span>
            <span><b>M²:</b> {hoveredCustomer.areaM2 || '-'}</span>
            <span><b>Telefon:</b> {hoveredCustomer.phone || '-'}</span>
            <span><b>Cep:</b> {hoveredCustomer.mobilePhone || '-'}</span>
            <span><b>Vergi No:</b> {hoveredCustomer.taxNo || '-'}</span>
            <span><b>Vergi Dairesi:</b> {hoveredCustomer.taxOffice || '-'}</span>
            <span><b>Konum:</b> {hoveredCustomer.location || '-'}</span>
            <span><b>Bakiye:</b> {hoveredCustomer.balance || '-'}</span>
            <span className="customer-hover-toast-wide"><b>Adres:</b> {hoveredCustomer.address || '-'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
