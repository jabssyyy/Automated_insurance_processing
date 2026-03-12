/**
 * NotificationPanel — bell icon with dropdown of notifications.
 * Used by all views.
 */

import React, { useState, useEffect, useRef } from 'react'
import { Bell, MessageSquare, Smartphone, Bell as BellIcon, CheckCheck } from 'lucide-react'
import { getNotifications, markNotificationRead } from '../services/api'

const CHANNEL_ICONS = {
  whatsapp: MessageSquare,
  sms: Smartphone,
  in_app: BellIcon,
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationPanel() {
  const [notifications, setNotifications] = useState([])
  const [open, setOpen]                   = useState(false)
  const panelRef                          = useRef(null)

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const fetchNotifications = async () => {
    try {
      const res = await getNotifications()
      setNotifications(res.data?.notifications || res.data || [])
    } catch {
      // Silent fail — backend may not be running
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000) // poll every 30s
    return () => clearInterval(interval)
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleRead = async (notification) => {
    if (notification.is_read) return
    try {
      await markNotificationRead(notification.id)
      setNotifications((prev) =>
        prev.map((n) => n.id === notification.id ? { ...n, is_read: true } : n)
      )
    } catch {/* silent */}
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs text-blue-600 font-medium">{unreadCount} unread</span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">
                No notifications yet
              </div>
            ) : (
              notifications.slice(0, 20).map((n) => {
                const Icon = CHANNEL_ICONS[n.channel] || BellIcon
                return (
                  <button
                    key={n.id}
                    onClick={() => handleRead(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 transition-colors border-b border-slate-50 ${
                      !n.is_read ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${!n.is_read ? 'bg-blue-100' : 'bg-slate-100'}`}>
                      <Icon className={`w-3.5 h-3.5 ${!n.is_read ? 'text-blue-600' : 'text-slate-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-relaxed ${!n.is_read ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                        {n.message}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.sent_at)}</p>
                    </div>
                    {n.is_read && <CheckCheck className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
