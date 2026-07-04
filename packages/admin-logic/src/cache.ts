export interface AdminCacheHooks {
  onPlacesMutated?: () => Promise<void>;
}

export const noopAdminCacheHooks: AdminCacheHooks = {};
