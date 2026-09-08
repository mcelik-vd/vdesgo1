import { useState } from 'react'

type DefinitionWindowProps = {
  title: string
  tabs?: string[]
  description: string
}

export function DefinitionWindow({ title, tabs = [], description }: DefinitionWindowProps) {
  const [activeTab, setActiveTab] = useState(tabs[0] ?? title)

  return (
    <div className="definition-window">
      {tabs.length > 0 && (
        <div aria-label={`${title} sekmeleri`} className="definition-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? 'is-selected' : ''}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
      )}
      <section className="definition-panel">
        <p className="definition-kicker">TANIMLAMA MODÜLÜ</p>
        <h2>{activeTab}</h2>
        <p>{description}</p>
        <div className="definition-placeholder">{activeTab} çalışma alanı</div>
      </section>
    </div>
  )
}
