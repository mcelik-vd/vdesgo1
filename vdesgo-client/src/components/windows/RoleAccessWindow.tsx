import { useEffect, useState } from 'react'

type CustomerRow = {
  code: string
  name: string
}

type DistributorUser = {
  customerCode: string
  customerName: string
  username: string
  password: string
  role: string
  status: 'Aktif' | 'Pasif'
}

type FactoryUser = {
  username: string
  password: string
  role: string
}

type DistributorAccessValue = {
  visible: boolean
  actions: {
    view: boolean
    create: boolean
    edit: boolean
    delete: boolean
  }
}

type DistributorAccessMatrix = Record<string, Record<string, DistributorAccessValue>>

type MenuDefinition = {
  key: string
  title: string
  description: string
  operations: Array<'view' | 'create' | 'edit' | 'delete'>
}

const menuDefinitions: MenuDefinition[] = [
  { key: 'WarehouseDefinition', title: 'Distribütör Depoları', description: 'Depo tanımları ve stok görünürlüğü', operations: ['view', 'create', 'edit', 'delete'] },
  { key: 'ProductDefinition', title: 'Merkez Ürün Kataloğu', description: 'Fiyat ve ürün tanımları', operations: ['view', 'create', 'edit', 'delete'] },
  { key: 'SalesRepresentativeDefinition', title: 'Satış Temsilcisi', description: 'Temsilci ve rota düzenleme', operations: ['view', 'create', 'edit'] },
  { key: 'CustomerDefinition', title: 'Cari Kartları', description: 'Müşteri ve cari işlemleri', operations: ['view', 'create', 'edit', 'delete'] },
  { key: 'ShipmentDefinition', title: 'Sevkiyat ve Dağıtım', description: 'Dağıtım akışı ve sevkiyat takibi', operations: ['view', 'create', 'edit'] },
  { key: 'PromotionDefinition', title: 'Promosyon Politikası', description: 'Merkez promosyon kuralları', operations: ['view', 'edit'] },
  { key: 'RoleAccessDefinition', title: 'Yetki ve Kullanıcı Tanımları', description: 'Kullanıcı yetki matrisi', operations: ['view', 'edit'] },
]

const customerSubDefinitions: MenuDefinition[] = [
  { key: 'CustomerTypeDefinition', title: 'Cari Tip Tanımlama', description: 'Cari tip kayıtları', operations: ['view', 'create', 'edit', 'delete'] },
  { key: 'CustomerGroupDefinition', title: 'Cari Grup Tanımlama', description: 'Cari grup kayıtları', operations: ['view', 'create', 'edit', 'delete'] },
  { key: 'ChiefDefinition', title: 'Şef Tanımlama', description: 'Şef kayıtları', operations: ['view', 'create', 'edit', 'delete'] },
  { key: 'CustomerRegionDefinition', title: 'Cari Bölge Tanımlama', description: 'Cari bölge kayıtları', operations: ['view', 'create', 'edit', 'delete'] },
]

const operationLabels: Record<MenuDefinition['operations'][number], string> = {
  view: 'Görünüm',
  create: 'Ekle',
  edit: 'Düzenle',
  delete: 'Sil',
}

const createDefaultMatrix = (): DistributorAccessMatrix => ({
  antalya_admin: {
    WarehouseDefinition: { visible: true, actions: { view: true, create: true, edit: true, delete: true } },
    ProductDefinition: { visible: true, actions: { view: true, create: true, edit: true, delete: true } },
    SalesRepresentativeDefinition: { visible: false, actions: { view: true, create: false, edit: false, delete: false } },
    CustomerDefinition: { visible: true, actions: { view: true, create: true, edit: true, delete: true } },
    ShipmentDefinition: { visible: true, actions: { view: true, create: true, edit: true, delete: false } },
    PromotionDefinition: { visible: true, actions: { view: true, create: false, edit: true, delete: false } },
    RoleAccessDefinition: { visible: true, actions: { view: true, create: false, edit: true, delete: false } },
  },
  burdur_sales: {
    WarehouseDefinition: { visible: true, actions: { view: true, create: true, edit: false, delete: false } },
    ProductDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
    SalesRepresentativeDefinition: { visible: true, actions: { view: true, create: true, edit: true, delete: false } },
    CustomerDefinition: { visible: true, actions: { view: true, create: true, edit: true, delete: false } },
    ShipmentDefinition: { visible: true, actions: { view: true, create: false, edit: true, delete: false } },
    PromotionDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
    RoleAccessDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
  },
  mersin_prod: {
    WarehouseDefinition: { visible: true, actions: { view: true, create: false, edit: true, delete: false } },
    ProductDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
    SalesRepresentativeDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
    CustomerDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
    ShipmentDefinition: { visible: true, actions: { view: true, create: false, edit: true, delete: false } },
    PromotionDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
    RoleAccessDefinition: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
  },
})

export function RoleAccessWindow() {
  const [accounts, setAccounts] = useState<DistributorUser[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [selectedUsername, setSelectedUsername] = useState('')
  const [distributorForm, setDistributorForm] = useState({
    customerCode: '',
    customerName: '',
    username: '',
    password: '',
    role: 'Firma Yetkilisi',
    status: 'Aktif' as 'Aktif' | 'Pasif',
  })
  const [factoryAccounts, setFactoryAccounts] = useState<FactoryUser[]>([])
  const [factoryForm, setFactoryForm] = useState({ username: '', password: '', role: 'Diğer' })
  const [activeForm, setActiveForm] = useState<'distributor' | 'factory'>('distributor')
  const [isDistributorFormOpen, setIsDistributorFormOpen] = useState(false)
  const [isFactoryFormOpen, setIsFactoryFormOpen] = useState(false)

  const [accessMatrix, setAccessMatrix] = useState<DistributorAccessMatrix>(createDefaultMatrix)

  const selectedAccess = accessMatrix[selectedUsername] ?? {}

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    fetch(`${apiUrl}/data/customers`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: CustomerRow[]) => setCustomers(payload))
      .catch(() => window.alert('Cari kartlar veritabanından alınamadı.'))
  }, [])

  useEffect(() => {
    if (!selectedUsername) return
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    fetch(`${apiUrl}/security/access-matrix/${encodeURIComponent(selectedUsername)}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((permissions: Record<string, DistributorAccessValue>) => setAccessMatrix((current) => ({ ...current, [selectedUsername]: permissions })))
      .catch(() => undefined)
  }, [selectedUsername])

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

    Promise.all([
      fetch(`${apiUrl}/security/users`).then((response) => response.json()),
      fetch(`${apiUrl}/security/factory-users`).then((response) => response.json()),
    ])
      .then(([userPayload, factoryUserPayload]) => {
        if (Array.isArray(userPayload) && userPayload.length > 0) {
          setAccounts(userPayload)
          setSelectedUsername((current) => current || userPayload[0]?.username || '')
        }

        if (Array.isArray(factoryUserPayload)) setFactoryAccounts(factoryUserPayload)
      })
      .catch(() => undefined)
  }, [])

  const updateSelectedUserAccess = (moduleKey: string, field: 'visible' | 'view' | 'create' | 'edit' | 'delete', value: boolean) => {
    setAccessMatrix((currentMatrix) => {
      const nextMatrix = { ...currentMatrix }
      const currentEntry = { ...(nextMatrix[selectedUsername] ?? {}) }

      const nextValue = {
        visible: currentEntry[moduleKey]?.visible ?? true,
        actions: {
          view: currentEntry[moduleKey]?.actions?.view ?? true,
          create: currentEntry[moduleKey]?.actions?.create ?? false,
          edit: currentEntry[moduleKey]?.actions?.edit ?? false,
          delete: currentEntry[moduleKey]?.actions?.delete ?? false,
        },
      }

      if (field === 'visible') {
        nextValue.visible = value
        if (!value) {
          nextValue.actions = { view: false, create: false, edit: false, delete: false }
        }
      } else {
        nextValue.actions[field] = value

        if (field === 'view' && !value) {
          nextValue.visible = false
          nextValue.actions = { view: false, create: false, edit: false, delete: false }
        }

        if (field !== 'view' && value && !nextValue.visible) {
          nextValue.visible = true
        }
      }

      currentEntry[moduleKey] = nextValue
      nextMatrix[selectedUsername] = currentEntry

      return nextMatrix
    })
  }

  const saveMatrix = async () => {
    if (!selectedUsername) return
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${apiUrl}/security/access-matrix/${encodeURIComponent(selectedUsername)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions: accessMatrix[selectedUsername] ?? {} }),
    })
    if (!response.ok) window.alert('Yetki matrisi kaydedilemedi.')
  }

  const addAccount = async () => {
    if (!distributorForm.customerCode.trim() || !distributorForm.username.trim() || !distributorForm.password.trim()) {
      return
    }

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

    try {
      const response = await fetch(`${apiUrl}/security/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerCode: distributorForm.customerCode.trim(),
          customerName: distributorForm.customerName.trim(),
          username: distributorForm.username.trim(),
          password: distributorForm.password,
          role: distributorForm.role,
          status: distributorForm.status,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create user')
      }

      const created = await response.json()
      
      const newUser: DistributorUser = {
        customerCode: created.customerCode || distributorForm.customerCode,
        customerName: created.customerName || distributorForm.customerName,
        username: created.username || distributorForm.username,
        password: created.password ?? '********',
        role: created.role || distributorForm.role,
        status: created.status ?? 'Aktif',
      }
      
      setAccounts((current) => [...current, newUser])
      setSelectedUsername(newUser.username)
    } catch {
      const newUser: DistributorUser = {
        customerCode: distributorForm.customerCode.trim(),
        customerName: distributorForm.customerName.trim(),
        username: distributorForm.username.trim(),
        password: '********',
        role: distributorForm.role,
        status: distributorForm.status,
      }

      setAccounts((current) => [...current, newUser])
      setSelectedUsername(newUser.username)
    }

    setDistributorForm({ customerCode: '', customerName: '', username: '', password: '', role: 'Firma Yetkilisi', status: 'Aktif' })
  }

  const addFactoryAccount = async () => {
    if (!factoryForm.username.trim() || !factoryForm.password.trim()) return

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${apiUrl}/security/factory-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(factoryForm),
    })
    if (!response.ok) {
      window.alert('Merkez kullanıcısı kaydedilemedi.')
      return
    }

    const created = await response.json() as FactoryUser
    setFactoryAccounts((current) => [...current, created])
    setFactoryForm({ username: '', password: '', role: 'Diğer' })
  }

  const deleteDistributorAccount = async (username: string) => {
    if (!window.confirm(`${username} kullanıcısını silmek istediğinize emin misiniz?`)) return

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${apiUrl}/security/distributor-users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    if (!response.ok) {
      window.alert('Distribütör kullanıcısı silinemedi.')
      return
    }
    setAccounts((current) => current.filter((account) => account.username !== username))
    setAccessMatrix((current) => { const nextMatrix = { ...current }; delete nextMatrix[username]; return nextMatrix })
    setSelectedUsername((current) => current === username ? '' : current)
  }

  const changeDistributorPassword = async (username: string) => {
    const password = window.prompt(`${username} için yeni şifreyi girin:`)
    if (!password?.trim()) return

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${apiUrl}/security/distributor-users/${encodeURIComponent(username)}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      window.alert('Şifre güncellenemedi.')
      return
    }
    setAccounts((current) => current.map((account) => account.username === username ? { ...account, password: '********' } : account))
  }

  const deleteFactoryAccount = async (username: string) => {
    if (!window.confirm(`${username} kullanıcısını silmek istediğinize emin misiniz?`)) return

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${apiUrl}/security/factory-users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    if (!response.ok) {
      window.alert('Merkez kullanıcısı silinemedi.')
      return
    }
    setFactoryAccounts((current) => current.filter((account) => account.username !== username))
  }

  const changeFactoryPassword = async (username: string) => {
    const password = window.prompt(`${username} için yeni şifreyi girin:`)
    if (!password?.trim()) return

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${apiUrl}/security/factory-users/${encodeURIComponent(username)}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      window.alert('Şifre güncellenemedi.')
      return
    }
    setFactoryAccounts((current) => current.map((account) => account.username === username ? { ...account, password: '********' } : account))
  }

  return (
    <div className="role-access-window">
      <div className="definition-panel-heading">
        <div>
          <p className="definition-kicker">YETKİ VE KULLANICI TANIMLARI</p>
          <h2>Distribütör ve merkez kullanıcı yönetimi</h2>
        </div>
      </div>

      <div className="user-definition-tabs" role="tablist" aria-label="Kullanıcı tanım türü">
        <button
          aria-selected={activeForm === 'distributor'}
          className={activeForm === 'distributor' ? 'is-active' : ''}
          onClick={() => setActiveForm('distributor')}
          role="tab"
          type="button"
        >
          Distribütör Kullanıcısı
        </button>
        <button
          aria-selected={activeForm === 'factory'}
          className={activeForm === 'factory' ? 'is-active' : ''}
          onClick={() => setActiveForm('factory')}
          role="tab"
          type="button"
        >
          Merkez Kullanıcısı
        </button>
      </div>

      {activeForm === 'distributor' && <section className="role-access-form-panel">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">DISTRİBÜTÖR GİRİŞİ</p>
            <h2>Müşteri kullanıcı tanımlama</h2>
          </div>
          <button className="primary-action" onClick={() => setIsDistributorFormOpen((current) => !current)} type="button">
            {isDistributorFormOpen ? 'Formu Kapat' : 'Yeni'}
          </button>
        </div>

        {isDistributorFormOpen && <><div className="role-access-form-grid">
          <label>
            Müşteri Seçimi
            <select value={distributorForm.customerCode} onChange={(event) => {
              const selected = customers.find((c) => c.code === event.target.value)
              if (selected) {
                setDistributorForm({ ...distributorForm, customerCode: selected.code, customerName: selected.name })
              }
            }}>
              <option value="">Müşteri Seçiniz</option>
              {customers.map((customer) => (
                <option key={customer.code} value={customer.code}>{customer.name} ({customer.code})</option>
              ))}
            </select>
          </label>
          <label>
            Kullanıcı Adı
            <input value={distributorForm.username} onChange={(event) => setDistributorForm({ ...distributorForm, username: event.target.value })} placeholder="örn. antalya_admin" />
          </label>
          <label>
            Şifre
            <input type="password" value={distributorForm.password} onChange={(event) => setDistributorForm({ ...distributorForm, password: event.target.value })} placeholder="Şifre girin" />
          </label>
          <label>
            Yetki
            <select value={distributorForm.role} onChange={(event) => setDistributorForm({ ...distributorForm, role: event.target.value })}>
              <option>Muhasebeci</option>
              <option>Firma Yetkilisi</option>
              <option>Satış Temsilcisi</option>
            </select>
          </label>
          <label>
            Durum
            <select value={distributorForm.status} onChange={(event) => setDistributorForm({ ...distributorForm, status: event.target.value as 'Aktif' | 'Pasif' })}>
              <option value="Aktif">Aktif</option>
              <option value="Pasif">Pasif</option>
            </select>
          </label>
        </div>

        <button className="primary-action" onClick={addAccount} type="button">Kullanıcı Tanımla</button>
        </>}
      </section>}

      {activeForm === 'factory' && <section className="role-access-form-panel">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">MERKEZ KULLANICISI</p>
            <h2>Merkez yetki ve kullanıcı tanımlama</h2>
          </div>
          <button className="primary-action" onClick={() => setIsFactoryFormOpen((current) => !current)} type="button">
            {isFactoryFormOpen ? 'Formu Kapat' : 'Yeni'}
          </button>
        </div>
        {isFactoryFormOpen && <><div className="role-access-form-grid">
          <label>Kullanıcı Adı<input value={factoryForm.username} onChange={(event) => setFactoryForm({ ...factoryForm, username: event.target.value })} placeholder="örn. merkez_satis" /></label>
          <label>Şifre<input type="password" value={factoryForm.password} onChange={(event) => setFactoryForm({ ...factoryForm, password: event.target.value })} placeholder="Şifre girin" /></label>
          <label>Yetki
            <select value={factoryForm.role} onChange={(event) => setFactoryForm({ ...factoryForm, role: event.target.value })}>
              <option>Satış Müdürü</option><option>Genel Müdür</option><option>Üretim Müdürü</option><option>Diğer</option>
            </select>
          </label>
        </div>
        <button className="primary-action" onClick={addFactoryAccount} type="button">Merkez Kullanıcısı Tanımla</button>
        </>}
        <div className="customers-table-wrap" style={{ marginTop: '1rem' }}>
          <table className="customers-table product-table">
            <thead><tr><th>Kullanıcı Adı</th><th>Şifre</th><th>Yetki</th><th>İşlemler</th></tr></thead>
            <tbody>{factoryAccounts.map((account) => <tr key={account.username}><td>{account.username}</td><td>{account.password}</td><td>{account.role}</td><td><div className="user-row-actions"><button onClick={() => changeFactoryPassword(account.username)} type="button">Şifre Değiştir</button><button className="delete-action" onClick={() => deleteFactoryAccount(account.username)} type="button">Sil</button></div></td></tr>)}</tbody>
          </table>
        </div>
      </section>}

      {activeForm === 'distributor' && <section className="role-access-form-panel">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">DISTRİBÜTÖR YETKİ MATRİSİ</p>
            <h2>Menü ve işlem erişim tanımı</h2>
          </div>
        </div>

        <div className="role-access-form-grid" style={{ marginBottom: '1rem' }}>
          <label>
            Kullanıcı Seçimi
            <select value={selectedUsername} onChange={(event) => setSelectedUsername(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.username} value={account.username}>{account.customerName} ({account.customerCode}) · {account.username}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="customers-table-wrap">
          <table className="customers-table product-table">
            <thead>
              <tr>
                <th>Menü</th>
                <th>Görünür</th>
                {menuDefinitions[0]?.operations.map((operation) => (
                  <th key={operation}>{operationLabels[operation]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {menuDefinitions.map((menu) => {
                const currentValue = selectedAccess[menu.key] ?? { visible: false, actions: { view: false, create: false, edit: false, delete: false } }

                return (
                  <tr key={menu.key}>
                    <td>
                      <strong>{menu.title}</strong>
                      <div style={{ fontSize: '11px', color: '#667085' }}>{menu.description}</div>
                    </td>
                    <td>
                      <input
                        checked={currentValue.visible}
                        onChange={(event) => updateSelectedUserAccess(menu.key, 'visible', event.target.checked)}
                        type="checkbox"
                      />
                    </td>
                    {menu.operations.map((operation) => (
                      <td key={`${menu.key}-${operation}`}>
                        <input
                          checked={Boolean(currentValue.actions?.[operation])}
                          disabled={!currentValue.visible}
                          onChange={(event) => updateSelectedUserAccess(menu.key, operation, event.target.checked)}
                          type="checkbox"
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="primary-action" onClick={saveMatrix} type="button">Yetki Matrisini Kaydet</button>
        </div>
      </section>}

      {activeForm === 'distributor' && <section className="role-access-form-panel">
        <div className="definition-panel-heading">
          <div>
            <p className="definition-kicker">CARİ KARTLARI ALT YETKİLERİ</p>
            <h2>Cari tip, grup, şef ve bölge yetkilendirmesi</h2>
          </div>
        </div>
        <div className="customers-table-wrap">
          <table className="customers-table product-table">
            <thead><tr><th>Alan</th><th>Görünüm</th><th>Ekle</th><th>Düzenle</th><th>Sil</th></tr></thead>
            <tbody>{customerSubDefinitions.map((definition) => {
              const value = selectedAccess[definition.key] ?? { visible: true, actions: { view: true, create: false, edit: false, delete: false } }
              return <tr key={definition.key}><td><strong>{definition.title}</strong><div style={{ fontSize: '11px', color: '#667085' }}>{definition.description}</div></td><td><input checked={value.visible} onChange={(event) => updateSelectedUserAccess(definition.key, 'visible', event.target.checked)} type="checkbox" /></td>{definition.operations.map((operation) => <td key={operation}><input checked={Boolean(value.actions[operation])} disabled={!value.visible} onChange={(event) => updateSelectedUserAccess(definition.key, operation, event.target.checked)} type="checkbox" /></td>)}</tr>
            })}</tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}><button className="primary-action" onClick={saveMatrix} type="button">Alt Yetkileri Kaydet</button></div>
      </section>}

      {activeForm === 'distributor' && <div className="customers-table-wrap">
        <table className="customers-table product-table">
          <thead>
            <tr>
              <th>Müşteri Adı</th>
              <th>Müşteri Kodu</th>
              <th>Kullanıcı Adı</th>
              <th>Şifre</th>
              <th>Yetki</th>
              <th>Durum</th>
              <th>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={`${account.customerCode}-${account.username}`}>
                <td>{account.customerName}</td>
                <td className="customer-code">{account.customerCode}</td>
                <td>{account.username}</td>
                <td>{account.password}</td>
                <td>{account.role}</td>
                <td>
                  <span className={account.status === 'Aktif' ? 'status-active' : 'status-inactive'}>{account.status}</span>
                </td>
                <td>
                  <div className="user-row-actions">
                    <button onClick={() => changeDistributorPassword(account.username)} type="button">Şifre Değiştir</button>
                    <button className="delete-action" onClick={() => deleteDistributorAccount(account.username)} type="button">Sil</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  )
}
