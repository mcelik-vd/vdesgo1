import { create } from 'zustand'

export type InstanceType = 'SINGLE' | 'MULTIPLE'
export type WindowStatus = 'OPEN' | 'MINIMIZED' | 'MAXIMIZED'

export type WorkWindow = {
  id: string
  moduleName: string
  title: string
  receiptSaleType?: 'Soğuk Satış' | 'Sıcak Satış'
  receiptReturnType?: 'Sağlam' | 'Bozuk'
  collectionType?: 'Tahsilat' | 'Bakiye Düşürme' | 'Bakiye Yükseltme'
  instanceType: InstanceType
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  status: WindowStatus
  isDirty: boolean
}

type WindowBounds = Pick<WorkWindow, 'x' | 'y' | 'width' | 'height'>
type PersistedWindow = Omit<WorkWindow, 'isDirty'>

type WindowState = {
  windows: WorkWindow[]
  activeWindowId: string | null
  layoutUserId: string | null
  openWindow: (window: Omit<WorkWindow, 'id' | 'zIndex' | 'status' | 'isDirty'> & { id?: string }) => string
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  focusWindow: (id: string) => void
  updateBounds: (id: string, bounds: Partial<WindowBounds>) => void
  setDirtyState: (id: string, isDirty: boolean) => void
  hydrateLayout: (userId: string) => void
  persistLayout: () => void
}

const layoutKey = (userId: string) => `vdesgo_layout_state_${userId}`

const createId = (moduleName: string) =>
  `${moduleName.toLowerCase().replaceAll(' ', '-')}-${crypto.randomUUID()}`

const serializeWindow = (window: WorkWindow): PersistedWindow => ({
  id: window.id,
  moduleName: window.moduleName,
  title: window.title,
  receiptSaleType: window.receiptSaleType,
  receiptReturnType: window.receiptReturnType,
  instanceType: window.instanceType,
  x: window.x,
  y: window.y,
  width: window.width,
  height: window.height,
  zIndex: window.zIndex,
  status: window.status,
})

export const useWindowStore = create<WindowState>((set, get) => {
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      get().persistLayout()
    }, 300)
  }

  return ({
  windows: [],
  activeWindowId: null,
  layoutUserId: null,

  openWindow: (window) => {
    const existing =
      window.instanceType === 'SINGLE'
        ? get().windows.find((item) => item.instanceType === 'SINGLE' && item.moduleName === window.moduleName)
        : undefined

    if (existing) {
      get().restoreWindow(existing.id)
      get().focusWindow(existing.id)
      return existing.id
    }

    const id = window.id ?? createId(window.moduleName)
    const nextZIndex = Math.max(0, ...get().windows.map((item) => item.zIndex)) + 1
    const offset = (get().windows.length % 6) * 28
    const nextWindow: WorkWindow = {
      ...window,
      id,
      x: window.x + offset,
      y: window.y + offset,
      zIndex: nextZIndex,
      status: 'OPEN',
      isDirty: false,
    }

    set((state) => ({
      windows: [...state.windows, nextWindow],
      activeWindowId: id,
    }))
    get().persistLayout()
    return id
  },

  closeWindow: (id) => {
    set((state) => ({
      windows: state.windows.filter((window) => window.id !== id),
      activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
    }))
    get().persistLayout()
  },

  minimizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id ? { ...window, status: 'MINIMIZED' } : window,
      ),
      activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
    }))
    get().persistLayout()
  },

  restoreWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id ? { ...window, status: 'OPEN' } : window,
      ),
      activeWindowId: id,
    }))
    get().persistLayout()
  },

  maximizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id ? { ...window, status: 'MAXIMIZED' } : window,
      ),
      activeWindowId: id,
    }))
    get().persistLayout()
  },

  focusWindow: (id) => {
    const nextZIndex = Math.max(0, ...get().windows.map((window) => window.zIndex)) + 1
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id ? { ...window, zIndex: nextZIndex } : window,
      ),
      activeWindowId: id,
    }))
    get().persistLayout()
  },

  updateBounds: (id, bounds) => {
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id ? { ...window, ...bounds } : window,
      ),
    }))
    schedulePersist()
  },

  setDirtyState: (id, isDirty) => {
    set((state) => ({
      windows: state.windows.map((window) => (window.id === id ? { ...window, isDirty } : window)),
    }))
  },

  hydrateLayout: (userId) => {
    const savedLayout = window.localStorage.getItem(layoutKey(userId))
    if (!savedLayout) {
      set({ layoutUserId: userId })
      return
    }

    try {
      const persistedWindows = JSON.parse(savedLayout) as PersistedWindow[]
      set({
        layoutUserId: userId,
        windows: persistedWindows.map((window) => ({ ...window, isDirty: false })),
        activeWindowId: persistedWindows.at(-1)?.id ?? null,
      })
    } catch {
      window.localStorage.removeItem(layoutKey(userId))
      set({ layoutUserId: userId })
    }
  },

  persistLayout: () => {
    const { layoutUserId, windows } = get()
    if (!layoutUserId) return
    window.localStorage.setItem(layoutKey(layoutUserId), JSON.stringify(windows.map(serializeWindow)))
  },
  })
})