fetch('/api/auth/verify', { credentials: 'same-origin', cache: 'no-store' })
  .then((response) => response.ok ? response.json() : null)
  .then((result) => {
    if (!result?.authenticated) return;
    const role = result.user?.platformRole;
    window.location.replace(role === 'admin' || role === 'super_admin' ? '/admin' : '/dashboard');
  })
  .catch(() => {});
