/** The player's 3D/2D preference, remembered in this browser only. */
import { useEffect, useState } from 'react'
import { supports3d, type View } from './GameCanvas'

const KEY = 'citychase:view'

export function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>('2d')
  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(KEY) } catch { /* storage blocked */ }
    setView(saved === '2d' || saved === '3d' ? saved : supports3d() ? '3d' : '2d')
  }, [])
  const set = (v: View) => {
    setView(v)
    try { localStorage.setItem(KEY, v) } catch { /* storage blocked */ }
  }
  return [view, set]
}
