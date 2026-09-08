import { useEffect, useState } from 'react'
import { ArrowRight, Boxes, Factory, Package2, Percent, ShieldCheck, Store, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

type DashboardSummary = {
  label: string
  value: string
  detail: string
}

type DashboardResponse = {
  summary: DashboardSummary[]
  products: Array<Record<string, unknown>>
  warehouses: Array<Record<string, unknown>>
  customers: Array<Record<string, unknown>>
  source: string
}

const moduleCards = [
  { title: 'Ürün Kataloğu', description: 'Fabrika merkezinde yönetilen ürün master data ve birim tanımları.', icon: Package2, accent: 'green' },
  { title: 'Merkez Fiyat Politikası', description: 'Merkezi liste fiyatı, KDV ve promosyon mantığı üretim merkezinde kontrol edilir.', icon: Percent, accent: 'gold' },
  { title: 'Distribütör Depoları', description: 'Her distribütörün depo kartı, stok hareketi ve transfer bilgileri ayrı yönetilir.', icon: Boxes, accent: 'blue' },
  { title: 'Distribütör Cari & Müşteri', description: 'Müşteri, bölge, temsilci ve cari bakiyeler distribütör bazlı izlenir.', icon: Users, accent: 'purple' },
  { title: 'Yetki ve Rol Yapısı', description: 'Fabrika merkezi yetki kontrolü, distribütör yöneticileri ve saha ekipleri ayrıştırılır.', icon: ShieldCheck, accent: 'orange' },
  { title: 'Operasyon Alanı', description: 'Tanımlamalar, depo, ürün ve müşteri yönetimi için çalışma alanı.', icon: Factory, accent: 'slate' },
]

const decisionList = [
  'Ürün kataloğu: merkezden yönetilen',
  'Fiyat: merkez fiyatı',
  'Stok: distribütör depolar',
  'Müşteri ve cari: distribütör',
]

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary[]>([])
  const [dataSource, setDataSource] = useState('loading')

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

    fetch(`${apiUrl}/factory/dashboard`)
      .then((response) => response.json())
      .then((payload: DashboardResponse) => {
        setSummary(payload.summary)
        setDataSource(payload.source)
      })
      .catch(() => {
        setSummary([
          { label: 'Aktif distribütör', value: '18', detail: '+2 bu ay' },
          { label: 'Merkez katalog ürünleri', value: '1.240', detail: '7 kategori' },
          { label: 'Toplam depo stok değeri', value: '₺4,8M', detail: 'Distribütör bazlı' },
          { label: 'Toplam müşteri bakiyesi', value: '₺2,1M', detail: 'Net müşteri bakiyesi' },
        ])
        setDataSource('fallback')
      })
  }, [])

  const kpis = summary.length
    ? summary.map((item, index) => ({
        ...item,
        icon: [Store, Package2, Boxes, Users][index % 4],
      }))
    : [
        { label: 'Aktif distribütör', value: '18', detail: '+2 bu ay', icon: Store },
        { label: 'Merkez katalog ürünleri', value: '1.240', detail: '7 kategori', icon: Package2 },
        { label: 'Toplam depo stok değeri', value: '₺4,8M', detail: 'Distribütör bazlı', icon: Boxes },
        { label: 'Toplam müşteri bakiyesi', value: '₺2,1M', detail: 'Net müşteri bakiyesi', icon: Users },
      ]

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">VD GIDA | FABRİKA MERKEZİ</p>
          <h1>VDesgo Operasyon Merkezi</h1>
        </div>
        <div className="header-actions">
          <Link className="ghost-button" to="/workspace">Çalışma Alanı</Link>
          <button className="primary-button" type="button">Yönetim Paneli</button>
        </div>
      </header>

      <section className="dashboard-hero">
        <div className="hero-copy">
          <span className="hero-tag">DAĞITIM ERP</span>
          <h2>Merkezden kontrol, distribütörden operasyon.</h2>
          <p>
            Fabrika olarak merkez yönetim, ürün kataloğu ve fiyat politikası belirler. Distribütörler kendi depolarında
            stokları yönetir, müşterileri ve cari işlemleri kendi kapsamlarında izler.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/workspace">
              İşlem Alanını Aç <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        <aside className="hero-panel">
          <p className="panel-label">İş Modeli</p>
          <ul>
            {decisionList.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="data-source-badge">Veri kaynağı: {dataSource}</div>
        </aside>
      </section>

      <section className="kpi-grid" aria-label="Özet metrikler">
        {kpis.map(({ label, value, detail, icon: Icon }) => (
          <article className="kpi-card" key={label}>
            <div className="kpi-icon"><Icon size={18} /></div>
            <div>
              <p>{label}</p>
              <strong>{value}</strong>
              <span>{detail}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="module-section">
        <div className="section-heading">
          <div>
            <p className="dashboard-eyebrow">YÖNETİM MODÜLLERİ</p>
            <h3>Operasyonel alanlar</h3>
          </div>
        </div>

        <div className="module-grid">
          {moduleCards.map(({ title, description, icon: Icon, accent }) => (
            <article className={`module-card ${accent}`} key={title}>
              <div className="module-icon"><Icon size={18} /></div>
              <h4>{title}</h4>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
