'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, UserRound } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [issuedByName, setIssuedByName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const label = user.issuedByName || user.name;
  const initial = label.slice(0, 1).toUpperCase() || 'C';

  const openEditor = () => {
    setIssuedByName(user.issuedByName || user.name);
    setError('');
    setEditing(true);
    setOpen(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await updateProfile({ issuedByName });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${label}`}
        className="flex items-center gap-2 px-1.5 py-1 text-stone-800 hover:text-stone-950 cursor-pointer"
        title={user.email}
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt=""
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center text-xs font-semibold">
            {initial}
          </span>
        )}
        {!compact && (
          <span className="hidden sm:block max-w-[9rem] truncate text-sm font-medium">{label}</span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-60 bg-white border border-stone-200 z-50">
          <div className="px-3 py-2.5 border-b border-stone-200">
            <p className="text-sm font-medium text-stone-900 truncate">{user.name}</p>
            <p className="text-xs text-stone-500 truncate">{user.email}</p>
            {user.role === 'admin' && <p className="text-xs text-stone-400 mt-1">Administrator</p>}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={openEditor}
            className="w-full text-left px-3 py-2 text-sm text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
          >
            <UserRound className="w-4 h-4" />
            Edit profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              logout();
              router.push('/login');
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 flex items-center gap-2 border-t border-stone-200 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-[80] bg-stone-900/40 flex items-center justify-center p-4"
          onClick={() => !saving && setEditing(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
            className="w-full max-w-md bg-[#FBFAF5] border border-stone-300 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="profile-title" className="font-jura text-2xl text-stone-900">
              Profile
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              This name is shown as the issuer when someone verifies a certificate you published.
            </p>
            <label className="mt-5 block text-xs uppercase tracking-wider text-stone-500" htmlFor="issued-by">
              Issued by
            </label>
            <input
              id="issued-by"
              value={issuedByName}
              onChange={(event) => setIssuedByName(event.target.value)}
              maxLength={120}
              className="mt-2 w-full bg-transparent border-b border-stone-300 py-2 text-stone-900 outline-none focus:border-stone-900"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-4">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="text-sm text-stone-500 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="text-sm font-semibold text-stone-900 cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
