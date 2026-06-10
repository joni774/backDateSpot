// Shared types for API and mobile client.

export type SubscriptionTier = "FREE" | "PREMIUM" | "VIP";

export type PlaceCategory =
  | "ROMANTIC_DATE"
  | "RESTAURANT"
  | "DAIRY_RESTAURANT"
  | "MEAT_RESTAURANT"
  | "SUSHI"
  | "SUNSET"
  | "ATTRACTION";

export type PriceRange = "FREE" | "BUDGET" | "MODERATE" | "EXPENSIVE";

export type Language = "he" | "en" | "ar";

export interface PlaceListItem {
  id: string;
  name: string;
  description: string;
  category: PlaceCategory;
  distance: number | null;
  priceRange: PriceRange;
  images: string[];
  openingHours: Record<string, string>;
  isLocked?: boolean;
}

export interface PlaceDetail extends PlaceListItem {
  nameHe: string;
  nameEn: string;
  nameAr: string;
  latitude: number;
  longitude: number;
  address: string;
  phone?: string | null;
  website?: string | null;
  isOpen: boolean;
  isSaved: boolean;
}

export interface AuthUser {
  id: string;
  fullName: string;
  age: number;
  phone: string;
  email: string;
  subscriptionTier: SubscriptionTier;
  isAdmin: boolean;
}

export interface AdminUserListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  subscriptionTier: SubscriptionTier;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Mobile client API contract (prompt 4.1 prep). */
export interface MobileApiConfig {
  baseUrl: string;
  defaultLanguage: Language;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
}
