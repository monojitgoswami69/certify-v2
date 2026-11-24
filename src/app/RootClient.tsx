'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/useAuthStore';
import { signedInHome } from '../lib/access-role';

export default function SignedInRedirect() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(signedInHome(user?.platformRole));
  }, [isLoading, isAuthenticated, user?.platformRole, router]);

  return null;
}
