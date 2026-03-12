import React, { useState, useEffect } from 'react';
import { Bell, MessageSquare, Smartphone, X, Check } from 'lucide-react';
import { getNotifications, markNotificationRead } from '../services/api';

/**
 * Bell icon with unread count badge. Click opens a dropdown with
 * notification list. Each notification shows message, timestamp,
 * and channel icon (WhatsApp / SMS / in-app).
 */
export default function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = async () => {
    try {
      const data = await getNotifications();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch {
      // Silently handle — panel just shows empty
    }
  };

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 15000); // Poll every 15s
    return () => clearInterval(timer);
  }, []);

  const handleMarkRead = async (id) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Ignore
    }
  };

  const channelIcon = (ch) => {
    switch (ch) {
      case 'whatsapp':
        return <span className="text-green-500 text-sm">💬</span>;
      case 'sms':
        return <Smartphone className="w-3.5 h-3.5 text-blue-500" />;
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="relative">
      {/* Bell */}
      <button
        onClick={() => { setIsOpen(!isOpen); if (!isOpen) fetchNotifications(); }}
        className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="absolute right-0 top-12 w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Notifications</h3>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                    className={`px-5 py-4 cursor-pointer transition-colors ${
                      n.is_read ? 'bg-white' : 'bg-blue-50/40 hover:bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{channelIcon(n.channel)}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-relaxed ${n.is_read ? 'text-slate-500' : 'text-slate-800 font-medium'}`}>
                          {n.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[11px] text-slate-400 font-medium">
                            {n.sent_at ? new Date(n.sent_at).toLocaleString() : 'Pending'}
                          </span>
                          {n.is_read && (
                            <span className="flex items-center gap-0.5 text-[10px] text-green-500 font-medium">
                              <Check className="w-3 h-3" /> Read
                            </span>
                          )}
                        </div>
                      </div>
                      {!n.is_read && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
