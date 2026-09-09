import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Fullscreen, LogOut, Maximize2, Minimize, Minus, Square, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DefinitionWindow } from '../components/windows/DefinitionWindow'
import { CustomersWindow } from '../components/windows/CustomersWindow'
import { DistributorCustomersWindow } from '../components/windows/DistributorCustomersWindow'
import { WarehouseWindow } from '../components/windows/WarehouseWindow'
import { ProductDefinitionWindow } from '../components/windows/ProductDefinitionWindow'
import { RoleAccessWindow } from '../components/windows/RoleAccessWindow'
import { SalesRepresentativeWindow } from '../components/windows/SalesRepresentativeWindow'
import { ShipmentWindow } from '../components/windows/ShipmentWindow'
import { OtherStockEntryWindow } from '../components/windows/OtherStockEntryWindow'
import { OtherStockExitWindow } from '../components/windows/OtherStockExitWindow'
import { WarehouseTransferWindow } from '../components/windows/WarehouseTransferWindow'
import { VehicleLoadingWindow } from '../components/windows/VehicleLoadingWindow'
import { RepresentativeCustomerAssignmentWindow } from '../components/windows/RepresentativeCustomerAssignmentWindow'
import { ReceiptOperationsWindow } from '../components/windows/ReceiptOperationsWindow'
import { CollectionOperationsWindow } from '../components/windows/CollectionOperationsWindow'
import { CollectionEntryWindow } from '../components/windows/CollectionEntryWindow'
import { ReceiptEntryWindow } from '../components/windows/ReceiptEntryWindow'
import { WarehouseOperationsListWindow } from '../components/windows/WarehouseOperationsListWindow'
import { StockReportsWindow } from '../components/windows/StockReportsWindow'
import { WarehouseTransferReportsWindow } from '../components/windows/WarehouseTransferReportsWindow'
import { PromotionPolicyWindow } from '../components/windows/PromotionPolicyWindow'
import { useUnsavedWorkGuard } from '../hooks/useUnsavedWorkGuard'
import { useWindowStore } from '../stores/useWindowStore'

const userId = 'current-user'

type DefinitionModule = {
  moduleName: string
  title: string
  description: string
  tabs?: string[]
}

const definitionModules: DefinitionModule[] = [
  { moduleName: 'WarehouseDefinition', title: 'Distribütör Depoları', description: 'Her distribütörün depo kartı, depolama alanı ve stok durumu burada yönetilir.' },
  { moduleName: 'ProductDefinition', title: 'Merkez Ürün Kataloğu', description: 'Ürün master data, fiyat politikası ve ürün birim tanımları merkezden yönetilir.', tabs: ['Ürün Tanımlama', 'Ürün Fiyat Tanımlama', 'Ürün Grup Tanımlama', 'Ürün Tipi Tanımlama'] },
  { moduleName: 'SalesRepresentativeDefinition', title: 'Satış Temsilcisi Yönetimi', description: 'Distribütör bazlı satış temsilcisi ve rota tanımları burada yönetilir.', tabs: ['Satış Temsilcisi Tanımlama', 'Rut Tanımlama'] },
  { moduleName: 'CustomerDefinition', title: 'Cari Kart Tanımlama', description: 'Müşteri, cari tipi, grubu ve bölgesi merkez kontrolünde yönetilir.', tabs: ['Cari Tanımlama', 'Cari Tipi Tanımlama', 'Cari Grup Tanımlama', 'Cari Bölge Tanımlama'] },
  { moduleName: 'ShipmentDefinition', title: 'Sevkiyat ve Dağıtım', description: 'Sevkiyat araçları ve dağıtım akışları burada izlenir.' },
  { moduleName: 'PromotionDefinition', title: 'Merkez Promosyon Politikası', description: 'Fabrika merkezinde tanımlanan promosyon ve indirim kuralları burada kontrol edilir.' },
  { moduleName: 'RoleAccessDefinition', title: 'Yetki ve Kullanıcı Tanımları', description: 'Genel müdür, satış müdürü, üretim müdürü ve distribütör kullanıcı yetki matrisi yönetilir.', tabs: ['Yetki Tanımları', 'Distribütör Girişleri'] },
]

const distributorGeneralModules: DefinitionModule[] = [
  { moduleName: 'WarehouseDefinition', title: 'Depo', description: 'Depo tanımları ve stok görünürlüğü.' },
  { moduleName: 'ProductDefinition', title: 'Ürünler', description: 'Ürünler ve ürün bazlı tanımlamalar.' },
  { moduleName: 'SalesRepresentativeDefinition', title: 'Satış Temsilcisi', description: 'Satış temsilcisi ve rota tanımları.' },
  { moduleName: 'CustomerDefinition', title: 'Cariler', description: 'Cari kart ve müşteri tanımları.' },
  { moduleName: 'ShipmentDefinition', title: 'Sevkiyat Araçları', description: 'Sevkiyat araçları ve dağıtım tanımları.' },
]

const warehouseOperationModules: DefinitionModule[] = [
  { moduleName: 'WarehouseOperationsList', title: 'İşlemler Listesi', description: 'Sair giriş, sair çıkış, depo transferi, araç yükleme ve sayım kayıtları burada listelenir.' },
  { moduleName: 'OtherStockEntry', title: 'Sair Giriş', description: 'Depoya yapılan sair ürün girişleri burada yönetilir.' },
  { moduleName: 'OtherStockExit', title: 'Sair Çıkış', description: 'Depodan yapılan sair ürün çıkışları burada yönetilir.' },
  { moduleName: 'WarehouseTransfer', title: 'Depolar Arası Transfer', description: 'Depolar arasındaki stok transferleri burada yönetilir.' },
  { moduleName: 'VehicleLoading', title: 'Araç Yükleme', description: 'Araç yükleme ve sevkiyat hazırlık işlemleri burada yönetilir.' },
  { moduleName: 'StockCount', title: 'Sayım İşlemleri', description: 'Depo stok sayım işlemleri burada yürütülür.' },
]

const reportModules: DefinitionModule[] = [
  { moduleName: 'StockReports', title: 'Stok Raporları', description: 'Depo stok durumuna ilişkin raporlar burada görüntülenir.' },
  { moduleName: 'SalesReports', title: 'Satış Raporları', description: 'Satış performansı ve satış hareketlerine ilişkin raporlar burada görüntülenir.' },
]
const stockReportModules: DefinitionModule[] = [
  { moduleName: 'StockReports', title: 'Stok Raporu', description: 'Depo stok durumuna ilişkin raporlar burada görüntülenir.' },
  { moduleName: 'WarehouseTransferReports', title: 'Depolar Arası Stok Hareketleri', description: 'Depolar arasındaki transfer hareketleri tarih, depo ve ürün bazında raporlanır.' },
]

const representativeOperationModules: DefinitionModule[] = [
  { moduleName: 'RepresentativeCustomerAssignment', title: 'Rut / Müşteri Ataması', description: 'Temsilci rut ve müşteri atamaları burada yönetilir.' },
  { moduleName: 'RepresentativeOpeningClosing', title: 'Açılış / Kapanış İşlemleri', description: 'Temsilci açılış ve kapanış işlemleri burada takip edilir.' },
  { moduleName: 'RepresentativeRouteLocation', title: 'Konum Rut Bilgisi', description: 'Temsilci konum ve rut bilgileri burada görüntülenir.' },
  { moduleName: 'VehicleLoadingRequest', title: 'Araç Yükleme İsteği', description: 'Temsilcilerin araç yükleme talepleri burada oluşturulur ve takip edilir.' },
]

const invoiceOperationModules: DefinitionModule[] = [
  { moduleName: 'ReceiptOperations', title: 'Fiş İşlemleri', description: 'Fatura ve fiş işlemleri burada yönetilir.' },
]
const collectionOperationModules: DefinitionModule[] = [
  { moduleName: 'CollectionOperations', title: 'Tahsilat', description: 'Müşteri tahsilatları ve bakiye hareketleri.' },
  { moduleName: 'BalanceDecrease', title: 'Bakiye Düşürme', description: 'Cari bakiyesini düşüren işlemler.' },
  { moduleName: 'BalanceIncrease', title: 'Bakiye Yükseltme', description: 'Cari bakiyesini yükselten işlemler.' },
]

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

type PointerInteraction = {
  id: string
  mode: 'drag' | 'resize'
  direction?: ResizeDirection
  pointerX: number
  pointerY: number
  bounds: { x: number; y: number; width: number; height: number }
}

const resizeDirections: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

const canAccessModule = (role: string, moduleName: string) => {
  const normalizedRole = role?.toLowerCase() ?? ''

  if (normalizedRole.includes('genel') || normalizedRole.includes('general')) return true
  if (normalizedRole.includes('satış') || normalizedRole.includes('sales')) {
    return ['CustomerDefinition', 'WarehouseDefinition', 'SalesRepresentativeDefinition', 'ShipmentDefinition', 'RoleAccessDefinition'].includes(moduleName) === false
  }
  if (normalizedRole.includes('üretim') || normalizedRole.includes('production')) {
    return ['ProductDefinition', 'WarehouseDefinition', 'ShipmentDefinition', 'RoleAccessDefinition'].includes(moduleName) === true
  }

  return false
}

type DistributorModuleAccess = {
  visible: boolean
}

export function WorkspacePage() {
  const [definitionsOpen, setDefinitionsOpen] = useState(false)
  const [warehouseOperationsOpen, setWarehouseOperationsOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [representativeOperationsOpen, setRepresentativeOperationsOpen] = useState(false)
  const [invoiceOperationsOpen, setInvoiceOperationsOpen] = useState(false)
  const [collectionOperationsOpen, setCollectionOperationsOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [savingRequest, setSavingRequest] = useState(false)
  const [generalMenuExpanded, setGeneralMenuExpanded] = useState(true)
  const [currentUser, setCurrentUser] = useState<{ role?: string; distributor?: string; username?: string; accountType?: 'factory' | 'distributor' } | null>(null)
  const [distributorAccess, setDistributorAccess] = useState<Record<string, DistributorModuleAccess> | null>(null)
  const windows = useWindowStore((state) => state.windows)
  const activeWindowId = useWindowStore((state) => state.activeWindowId)
  const openWindow = useWindowStore((state) => state.openWindow)
  const closeWindow = useWindowStore((state) => state.closeWindow)
  const minimizeWindow = useWindowStore((state) => state.minimizeWindow)
  const restoreWindow = useWindowStore((state) => state.restoreWindow)
  const maximizeWindow = useWindowStore((state) => state.maximizeWindow)
  const focusWindow = useWindowStore((state) => state.focusWindow)
  const updateBounds = useWindowStore((state) => state.updateBounds)
  const hydrateLayout = useWindowStore((state) => state.hydrateLayout)
  const canvasRef = useRef<HTMLElement>(null)
  const interactionRef = useRef<PointerInteraction | null>(null)
  const savingRequestsRef = useRef(0)

  const navigate = useNavigate()

  useUnsavedWorkGuard()

  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = async (input, init) => {
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (!['POST', 'PUT', 'PATCH'].includes(method)) return originalFetch(input, init)

      savingRequestsRef.current += 1
      setSavingRequest(true)
      try {
        return await originalFetch(input, init)
      } finally {
        savingRequestsRef.current -= 1
        if (savingRequestsRef.current === 0) setSavingRequest(false)
      }
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  useEffect(() => {
    const storedUser = localStorage.getItem('vdesgo-user')
    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser))
    }
  }, [])

  useEffect(() => {
    if (currentUser?.accountType !== 'distributor' || !currentUser.username) {
      setDistributorAccess(null)
      return
    }

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    fetch(`${apiUrl}/security/access-matrix/${encodeURIComponent(currentUser.username)}`, {
      headers: {
        'x-vdesgo-account-type': currentUser.accountType || '',
        'x-vdesgo-username': currentUser.username,
      },
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((permissions: Record<string, DistributorModuleAccess>) => setDistributorAccess(permissions))
      .catch(() => setDistributorAccess({}))
  }, [currentUser])

  useEffect(() => {
    hydrateLayout(userId)
  }, [hydrateLayout])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current
      const canvas = canvasRef.current
      if (!interaction || !canvas) return

      const canvasRect = canvas.getBoundingClientRect()
      const deltaX = event.clientX - interaction.pointerX
      const deltaY = event.clientY - interaction.pointerY
      const minWidth = 320
      const minHeight = 210
      const nextBounds = { ...interaction.bounds }

      if (interaction.mode === 'drag') {
        nextBounds.x = Math.max(0, Math.min(canvasRect.width - nextBounds.width, interaction.bounds.x + deltaX))
        nextBounds.y = Math.max(0, Math.min(canvasRect.height - nextBounds.height, interaction.bounds.y + deltaY))
      } else {
        const direction = interaction.direction ?? 'se'
        const right = interaction.bounds.x + interaction.bounds.width
        const bottom = interaction.bounds.y + interaction.bounds.height

        if (direction.includes('e')) nextBounds.width = Math.max(minWidth, Math.min(canvasRect.width - nextBounds.x, interaction.bounds.width + deltaX))
        if (direction.includes('s')) nextBounds.height = Math.max(minHeight, Math.min(canvasRect.height - nextBounds.y, interaction.bounds.height + deltaY))
        if (direction.includes('w')) {
          const nextX = Math.max(0, Math.min(right - minWidth, interaction.bounds.x + deltaX))
          nextBounds.x = nextX
          nextBounds.width = right - nextX
        }
        if (direction.includes('n')) {
          const nextY = Math.max(0, Math.min(bottom - minHeight, interaction.bounds.y + deltaY))
          nextBounds.y = nextY
          nextBounds.height = bottom - nextY
        }
      }

      updateBounds(interaction.id, nextBounds)
    }

    const handlePointerUp = () => {
      interactionRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [updateBounds])

  const handleLogout = () => {
    localStorage.removeItem('vdesgo-user')
    window.dispatchEvent(new Event('storage'))
    navigate('/login', { replace: true })
  }

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  }

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined)
    }
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const launch = (module: DefinitionModule) => {
    const isFactoryUser = currentUser?.accountType === 'factory'
    const isDistributorUser = currentUser?.accountType === 'distributor'
    const isWarehouseOperation = warehouseOperationModules.some((item) => item.moduleName === module.moduleName)
    const isReport = [...reportModules, ...stockReportModules].some((item) => item.moduleName === module.moduleName)
    const isRepresentativeOperation = representativeOperationModules.some((item) => item.moduleName === module.moduleName)
    const isInvoiceOperation = invoiceOperationModules.some((item) => item.moduleName === module.moduleName)
    const isCollectionOperation = collectionOperationModules.some((item) => item.moduleName === module.moduleName)

    if (isFactoryUser) {
      // Merkez kullanıcılar tanımlama menüsünü yönetir; tüm tanımlama pencerelerine erişebilirler.
    } else if (isDistributorUser) {
      if (!isWarehouseOperation && !isReport && !isRepresentativeOperation && !isInvoiceOperation && !isCollectionOperation && !distributorAccess?.[module.moduleName]?.visible) {
        window.alert('Bu modüle erişim yetkiniz yok.')
        return
      }
    } else if (!currentUser?.role || !canAccessModule(currentUser.role, module.moduleName)) {
      window.alert('Bu modüle erişim yetkiniz yok.')
      return
    }

    const windowId = openWindow({
      moduleName: module.moduleName,
      title: module.title,
      instanceType: 'SINGLE',
      x: 84,
      y: 88,
      width: 620,
      height: 390,
    })
    maximizeWindow(windowId)
    setDefinitionsOpen(false)
    setWarehouseOperationsOpen(false)
    setReportsOpen(false)
    setRepresentativeOperationsOpen(false)
    setInvoiceOperationsOpen(false)
    setCollectionOperationsOpen(false)
  }

  const openOperationsListAfterSave = (windowId: string) => {
    closeWindow(windowId)
    launch(warehouseOperationModules[0])
  }

  const openReceiptOperationsAfterSave = (windowId: string, receiptType: 'Satış Faturası' | 'Alış Faturası' | 'İade Faturası' | 'Sipariş', record: { id?: number; no: string; date: string; customer: string; total: string; saleType?: 'Soğuk Satış' | 'Sıcak Satış' }) => {
    closeWindow(windowId)
    launch(invoiceOperationModules[0])
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('vdesgo:receipt-saved', { detail: { receiptType, record: { ...record, id: record.id ?? Date.now() } } })), 0)
  }

  const requestClose = (id: string) => {
    const workWindow = windows.find((item) => item.id === id)
    if (workWindow?.isDirty && !window.confirm('Kaydedilmemiş değişiklikler var. Kapatmak istiyor musunuz?')) {
      return
    }
    closeWindow(id)
  }

  const beginDrag = (event: React.PointerEvent<HTMLElement>, id: string) => {
    const workWindow = windows.find((item) => item.id === id)
    const target = event.target as HTMLElement
    if (!workWindow || workWindow.status === 'MAXIMIZED' || target.closest('button')) return

    event.preventDefault()
    focusWindow(id)
    interactionRef.current = {
      id,
      mode: 'drag',
      pointerX: event.clientX,
      pointerY: event.clientY,
      bounds: { x: workWindow.x, y: workWindow.y, width: workWindow.width, height: workWindow.height },
    }
  }

  const beginResize = (event: React.PointerEvent<HTMLDivElement>, id: string, direction: ResizeDirection) => {
    const workWindow = windows.find((item) => item.id === id)
    if (!workWindow || workWindow.status === 'MAXIMIZED') return

    event.preventDefault()
    event.stopPropagation()
    focusWindow(id)
    interactionRef.current = {
      id,
      mode: 'resize',
      direction,
      pointerX: event.clientX,
      pointerY: event.clientY,
      bounds: { x: workWindow.x, y: workWindow.y, width: workWindow.width, height: workWindow.height },
    }
  }

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <h1>VDesgo Operasyon Alanı</h1>
          {currentUser && <p className="workspace-user">{currentUser.distributor || 'Distribütör'} · {currentUser.role}</p>}
        </div>
        <nav aria-label="Modüller" className="module-launcher">
          <div className="definitions-menu">
            <button aria-expanded={definitionsOpen} className="definitions-trigger" onClick={() => setDefinitionsOpen(!definitionsOpen)} type="button">
              Tanımlamalar <ChevronDown size={16} />
            </button>
            {definitionsOpen && (
              <div className="definitions-dropdown" role="menu">
                {currentUser?.accountType === 'distributor' ? (
                  <div className="definitions-group" role="group" aria-label="Genel tanımlamalar">
                    <button
                      className="definitions-group-header"
                      onClick={() => setGeneralMenuExpanded(!generalMenuExpanded)}
                      type="button"
                      aria-expanded={generalMenuExpanded}
                    >
                      <span>Genel</span>
                      <ChevronDown size={14} style={{ transform: generalMenuExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 200ms ease' }} />
                    </button>
                    {generalMenuExpanded && (
                      <div className="definitions-group-items">
                        {distributorGeneralModules
                          .filter((module) => Boolean(distributorAccess?.[module.moduleName]?.visible))
                          .map((module) => (
                            <button key={module.moduleName} onClick={() => launch(module)} role="menuitem" type="button">
                              {module.title}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ) : (
                  definitionModules
                    .filter((module) => {
                      if (currentUser?.accountType === 'factory') {
                        return true
                      }

                      if (currentUser?.accountType === 'distributor') {
                        return Boolean(distributorAccess?.[module.moduleName]?.visible)
                      }

                      return !currentUser?.role || canAccessModule(currentUser.role, module.moduleName)
                    })
                    .map((module) => (
                      <button key={module.moduleName} onClick={() => launch(module)} role="menuitem" type="button">
                        {module.title}
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
          <div className="definitions-menu">
            <button aria-expanded={warehouseOperationsOpen} className="definitions-trigger" onClick={() => setWarehouseOperationsOpen(!warehouseOperationsOpen)} type="button">
              Depo İşlemleri <ChevronDown size={16} />
            </button>
            {warehouseOperationsOpen && (
              <div className="definitions-dropdown" role="menu">
                <div className="definitions-group-items">
                  {warehouseOperationModules.map((module) => (
                    <button key={module.moduleName} onClick={() => launch(module)} role="menuitem" type="button">
                      {module.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="definitions-menu">
            <button aria-expanded={representativeOperationsOpen} className="definitions-trigger" onClick={() => setRepresentativeOperationsOpen(!representativeOperationsOpen)} type="button">
              Temsilci İşlemler <ChevronDown size={16} />
            </button>
            {representativeOperationsOpen && (
              <div className="definitions-dropdown" role="menu">
                <div className="definitions-group-items">
                  {representativeOperationModules.map((module) => (
                    <button key={module.moduleName} onClick={() => launch(module)} role="menuitem" type="button">
                      {module.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="definitions-menu">
            <button aria-expanded={invoiceOperationsOpen} className="definitions-trigger" onClick={() => setInvoiceOperationsOpen(!invoiceOperationsOpen)} type="button">
              Fatura İşlemleri <ChevronDown size={16} />
            </button>
            {invoiceOperationsOpen && (
              <div className="definitions-dropdown" role="menu">
                <div className="definitions-group-items">
                  {invoiceOperationModules.map((module) => (
                    <button key={module.moduleName} onClick={() => launch(module)} role="menuitem" type="button">
                      {module.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="definitions-menu">
            <button aria-expanded={collectionOperationsOpen} className="definitions-trigger" onClick={() => setCollectionOperationsOpen(!collectionOperationsOpen)} type="button">
              Tahsilat İşlemleri <ChevronDown size={16} />
            </button>
            {collectionOperationsOpen && (
              <div className="definitions-dropdown" role="menu">
                <div className="definitions-group-items">
                  {collectionOperationModules.map((module) => (
                    <button key={module.moduleName} onClick={() => launch(module)} role="menuitem" type="button">
                      {module.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="definitions-menu">
            <button aria-expanded={reportsOpen} className="definitions-trigger" onClick={() => setReportsOpen(!reportsOpen)} type="button">
              Raporlar <ChevronDown size={16} />
            </button>
            {reportsOpen && (
              <div className="definitions-dropdown" role="menu">
                <div className="definitions-group-items">
                  {reportModules.map((module) => (
                    module.moduleName === 'StockReports' ? <div className="definitions-submenu" key={module.moduleName}><button className="definitions-submenu-trigger" type="button">{module.title}<ChevronDown size={14} /></button><div className="definitions-submenu-items">{stockReportModules.map((submodule) => <button key={submodule.moduleName} onClick={() => void launch(submodule)} role="menuitem" type="button">{submodule.title}</button>)}</div></div> : <button key={module.moduleName} onClick={() => void launch(module)} role="menuitem" type="button">{module.title}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} className="ghost-button workspace-fullscreen" onClick={() => void toggleFullscreen()} type="button">
            {isFullscreen ? <Minimize size={15} /> : <Fullscreen size={15} />} {isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
          </button>
          <button className="ghost-button workspace-logout" onClick={handleLogout} type="button">
            <LogOut size={15} /> Çıkış
          </button>
        </nav>
      </header>

      <section aria-label="Çalışma alanı" className="window-canvas" ref={canvasRef}>
        {windows
          .filter((workWindow) => workWindow.status !== 'MINIMIZED')
          .map((workWindow) => {
            const maximized = workWindow.status === 'MAXIMIZED'
            const active = workWindow.id === activeWindowId
            return (
              <article
                className={`work-window ${active ? 'is-active' : ''} ${maximized ? 'is-maximized' : ''}`}
                key={workWindow.id}
                onPointerDown={() => focusWindow(workWindow.id)}
                style={
                  maximized
                    ? { zIndex: workWindow.zIndex }
                    : {
                        left: workWindow.x,
                        top: workWindow.y,
                        width: workWindow.width,
                        height: workWindow.height,
                        zIndex: workWindow.zIndex,
                      }
                }
              >
                <header className="work-window-header" onPointerDown={(event) => beginDrag(event, workWindow.id)}>
                  <span>{workWindow.title}{workWindow.isDirty ? ' *' : ''}</span>
                  <div className="window-actions">
                    <button aria-label="Simge durumuna küçült" onClick={() => minimizeWindow(workWindow.id)} type="button"><Minus size={16} /></button>
                    <button aria-label="Büyüt" onClick={() => maximizeWindow(workWindow.id)} type="button"><Maximize2 size={15} /></button>
                    <button aria-label="Geri yükle" onClick={() => restoreWindow(workWindow.id)} type="button"><Square size={14} /></button>
                    <button aria-label="Kapat" onClick={() => requestClose(workWindow.id)} type="button"><X size={16} /></button>
                  </div>
                </header>
                <div className="work-window-content">
                  {workWindow.moduleName === 'CustomerDefinition' ? (
                    currentUser?.accountType === 'distributor' ? <DistributorCustomersWindow /> : <CustomersWindow />
                  ) : workWindow.moduleName === 'WarehouseDefinition' ? (
                    <WarehouseWindow />
                  ) : workWindow.moduleName === 'ProductDefinition' ? (
                    <ProductDefinitionWindow />
                  ) : workWindow.moduleName === 'RoleAccessDefinition' ? (
                    <RoleAccessWindow />
                  ) : workWindow.moduleName === 'ShipmentDefinition' ? (
                    <ShipmentWindow />
                  ) : workWindow.moduleName === 'PromotionDefinition' ? (
                    <PromotionPolicyWindow />
                  ) : workWindow.moduleName === 'OtherStockEntry' ? (
                    <OtherStockEntryWindow onSaved={() => openOperationsListAfterSave(workWindow.id)} />
                  ) : workWindow.moduleName === 'OtherStockExit' ? (
                    <OtherStockExitWindow onSaved={() => openOperationsListAfterSave(workWindow.id)} />
                  ) : workWindow.moduleName === 'WarehouseTransfer' ? (
                    <WarehouseTransferWindow onSaved={() => openOperationsListAfterSave(workWindow.id)} />
                  ) : workWindow.moduleName === 'VehicleLoading' ? (
                    <VehicleLoadingWindow onSaved={() => openOperationsListAfterSave(workWindow.id)} />
                  ) : workWindow.moduleName === 'RepresentativeCustomerAssignment' ? (
                    <RepresentativeCustomerAssignmentWindow />
                  ) : workWindow.moduleName === 'ReceiptOperations' ? (
                    <ReceiptOperationsWindow />
                  ) : workWindow.moduleName === 'CollectionOperations' ? (
                    <CollectionOperationsWindow />
                  ) : workWindow.moduleName === 'CollectionEntry' ? (
                    <CollectionEntryWindow collectionType={workWindow.collectionType ?? 'Tahsilat'} onSaved={() => { closeWindow(workWindow.id); launch(collectionOperationModules[0]) }} />
                  ) : ['BalanceDecrease', 'BalanceIncrease'].includes(workWindow.moduleName) ? (
                    <CollectionEntryWindow collectionType={workWindow.moduleName === 'BalanceDecrease' ? 'Bakiye Düşürme' : 'Bakiye Yükseltme'} onSaved={() => { closeWindow(workWindow.id); launch(collectionOperationModules[0]) }} />
                  ) : ['SalesInvoiceEntry', 'PurchaseInvoiceEntry', 'ReturnInvoiceEntry', 'OrderEntry'].includes(workWindow.moduleName) ? (
                    <ReceiptEntryWindow receiptType={{ SalesInvoiceEntry: 'Satış Faturası', PurchaseInvoiceEntry: 'Alış Faturası', ReturnInvoiceEntry: 'İade Faturası', OrderEntry: 'Sipariş' }[workWindow.moduleName] as 'Satış Faturası' | 'Alış Faturası' | 'İade Faturası' | 'Sipariş'} saleType={workWindow.receiptSaleType} returnType={workWindow.receiptReturnType} onMissingSalesRepresentative={workWindow.moduleName === 'SalesInvoiceEntry' ? () => launch(representativeOperationModules[0]) : undefined} onSaved={['SalesInvoiceEntry', 'PurchaseInvoiceEntry', 'ReturnInvoiceEntry', 'OrderEntry'].includes(workWindow.moduleName) ? (record) => openReceiptOperationsAfterSave(workWindow.id, ({ SalesInvoiceEntry: 'Satış Faturası', PurchaseInvoiceEntry: 'Alış Faturası', ReturnInvoiceEntry: 'İade Faturası', OrderEntry: 'Sipariş' }[workWindow.moduleName] as 'Satış Faturası' | 'Alış Faturası' | 'İade Faturası' | 'Sipariş'), record) : undefined} />
                  ) : workWindow.moduleName === 'WarehouseOperationsList' ? (
                    <WarehouseOperationsListWindow />
                  ) : workWindow.moduleName === 'StockReports' ? (
                    <StockReportsWindow />
                  ) : workWindow.moduleName === 'WarehouseTransferReports' ? (
                    <WarehouseTransferReportsWindow />
                  ) : workWindow.moduleName === 'SalesRepresentativeDefinition' ? (
                    <SalesRepresentativeWindow />
                  ) : (
                    <DefinitionWindow
                      description={definitionModules.find((module) => module.moduleName === workWindow.moduleName)?.description ?? 'Tanımlama çalışma alanı.'}
                      tabs={definitionModules.find((module) => module.moduleName === workWindow.moduleName)?.tabs}
                      title={workWindow.title}
                    />
                  )}
                </div>
                {!maximized && resizeDirections.map((direction) => (
                  <div
                    aria-label={`${direction} yönünde yeniden boyutlandır`}
                    className={`resize-handle resize-${direction}`}
                    key={direction}
                    onPointerDown={(event) => beginResize(event, workWindow.id, direction)}
                    role="button"
                    tabIndex={-1}
                  />
                ))}
              </article>
            )
          })}
      </section>

      {savingRequest && <div aria-live="polite" className="saving-product-overlay"><div className="saving-product-message"><span className="saving-product-spinner" /> <strong>Lütfen bekleyiniz...</strong><span>İşlem kaydediliyor.</span></div></div>}

      <footer aria-label="Simge durumundaki pencereler" className="window-taskbar">
        {windows.filter((workWindow) => workWindow.status === 'MINIMIZED').map((workWindow) => (
          <button key={workWindow.id} onClick={() => restoreWindow(workWindow.id)} type="button">
            {workWindow.title}
          </button>
        ))}
      </footer>
    </main>
  )
}