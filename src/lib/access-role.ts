export type PlatformRole = 'user' | 'admin' | 'super_admin';

export interface PlatformPermissions {
  platformRole: PlatformRole;
  canIssueCertificates: boolean;
}

export const ISSUANCE_REQUIRED_HEADER = 'X-Certify-Issuance-Required';
export const ISSUANCE_ACCESS_CHANGED_EVENT = 'certify:issuance-access-changed';

export function canManageAccess(role: PlatformRole | null | undefined): role is Exclude<PlatformRole, 'user'> {
  return role === 'admin' || role === 'super_admin';
}

export function signedInHome(role: PlatformRole | null | undefined): '/admin' | '/dashboard' {
  return canManageAccess(role) ? '/admin' : '/dashboard';
}
