import { useState } from 'react'

type Product = { code: string; name: string; active: boolean }

type ProductCodePickerProps = {
  products: Product[]
  value: string
  onChange: (value: string) => void
  onSelect: (product: Product) => void
}

export function ProductCodePicker({ products, value, onChange, onSelect }: ProductCodePickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const visibleProducts = products.filter((product) => `${product.code} ${product.name}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')))

  const select = (product: Product) => {
    onSelect(product)
    setOpen(false)
    setSearch('')
  }

  return <>
    <div className="product-code-picker-input">
      <input autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Ürün kodu yazınız" />
      <button aria-label="Ürün listesini aç" className="secondary-action" onClick={() => setOpen(true)} type="button">Ürün seç</button>
    </div>
    {open && <div className="customer-picker-backdrop" onClick={() => setOpen(false)}>
      <section aria-modal="true" className="customer-picker-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="definition-panel-heading"><div><p className="definition-kicker">ÜRÜN SEÇİMİ</p><h2>Ürün Listesi</h2></div><button className="dialog-close" onClick={() => setOpen(false)} type="button">×</button></div>
        <input autoFocus className="customers-toolbar-input" onChange={(event) => setSearch(event.target.value)} placeholder="Kod veya ürün adı ara..." value={search} />
        <div className="product-picker-list">{visibleProducts.map((product) => <button key={product.code} onClick={() => select(product)} type="button"><strong>{product.code}</strong><span>{product.name}</span></button>)}{visibleProducts.length === 0 && <p className="dialog-hint">Ürün bulunamadı.</p>}</div>
      </section>
    </div>}
  </>
}
