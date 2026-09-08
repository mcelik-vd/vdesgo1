import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

export function LoginPage() {
  const [accountType, setAccountType] = useState<'distributor' | 'factory'>('distributor')
  const [username, setUsername] = useState('antalya_admin')
  const [password, setPassword] = useState('antalya123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (accountType === 'factory') {
      setUsername('merkez_admin')
      setPassword('merkez123')
      return
    }

    setUsername('antalya_admin')
    setPassword('antalya123')
  }, [accountType])

  useEffect(() => {
    const storedUser = localStorage.getItem('vdesgo-user')
    if (storedUser) {
      navigate('/workspace', { replace: true })
    }
  }, [navigate])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, accountType }),
      })

      const payload = await response.json()

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Giriş başarısız.')
      }

      localStorage.setItem('vdesgo-user', JSON.stringify(payload.user))
      window.dispatchEvent(new Event('storage'))
      navigate('/workspace', { replace: true })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Giriş başarısız.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="dashboard-eyebrow">VD GIDA | ERP GİRİŞ</p>
        <h1>VDesgo ERP Giriş</h1>
        <div className="account-type-switch" role="tablist" aria-label="Giriş tipi">
          <button className={accountType === 'distributor' ? 'is-active' : ''} onClick={() => setAccountType('distributor')} type="button">Distribütör Girişi</button>
          <button className={accountType === 'factory' ? 'is-active' : ''} onClick={() => setAccountType('factory')} type="button">Merkez Fabrika Girişi</button>
        </div>

        <p className="login-subtitle">
          {accountType === 'distributor'
            ? 'Distribütör kullanıcı adı ve şifresi ile sisteme giriş yapın.'
            : 'Merkez fabrika kullanıcı adı ve şifresi ile yönetim paneline giriş yapın.'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Kullanıcı Adı
            <input
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="antalya_admin"
              value={username}
            />
          </label>

          <label>
            Şifre
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Şifrenizi girin"
              type="password"
              value={password}
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="primary-button login-button" disabled={loading} type="submit">
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <div className="login-demo-box">
          <strong>{accountType === 'distributor' ? 'Distribütör demo kullanıcı' : 'Merkez fabrika demo kullanıcı'}</strong>
          <span>
            {accountType === 'distributor' ? 'antalya_admin / antalya123' : 'merkez_admin / merkez123'}
          </span>
        </div>
      </section>
    </main>
  )
}
