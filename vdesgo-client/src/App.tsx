import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { LoginPage } from './pages/LoginPage'
import { WorkspacePage } from './pages/WorkspacePage'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!localStorage.getItem('vdesgo-user'))

  useEffect(() => {
    const syncAuthState = () => {
      setIsAuthenticated(!!localStorage.getItem('vdesgo-user'))
    }

    window.addEventListener('storage', syncAuthState)
    return () => window.removeEventListener('storage', syncAuthState)
  }, [])

  return (
    <Routes>
      <Route element={<Navigate replace to="/login" />} path="/" />
      <Route element={isAuthenticated ? <Navigate replace to="/workspace" /> : <LoginPage />} path="/login" />
      <Route element={isAuthenticated ? <WorkspacePage /> : <Navigate replace to="/login" />} path="/workspace" />
      <Route element={<Navigate replace to="/login" />} path="*" />
    </Routes>
  )
}

export default App
