export const PLACES_LIST_KEY = "places:list";
export const PLACES_LIST_TTL = 120;

export interface PlacesListCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const noopPlacesListCache: PlacesListCache = {
  get: async () => null,
  set: async () => {},
};
