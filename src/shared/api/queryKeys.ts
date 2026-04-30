// Простые query-key константы для @tanstack/react-query.
// Используются всеми feature-хуками для invalidation и data-fetching.
export const BOARDS_QUERY_KEY = "boards";

export const FAVORITE_BOARDS_QUERY_KEY = "favorite-boards";

export const ME_QUERY_KEY = "me";

export const SPACES_QUERY_KEY = "spaces";

export const SPACE_MEMBERS_QUERY_KEY = "space-members";

// Admin-домен. Префикс ["admin", "X"]. Хук-list: [...ADMIN_QK.USERS, params].
// Invalidate через `queryClient.invalidateQueries({ queryKey: ADMIN_QK.USERS })`
// — prefix-match найдёт все варианты с разными params.
export const ADMIN_QK = {
  OVERVIEW: ["admin", "overview"] as const,
  TIMESERIES: ["admin", "timeseries"] as const,
  USERS: ["admin", "users"] as const,
  USER_ACTIVITY: ["admin", "user-activity"] as const,
  BOARDS: ["admin", "boards"] as const,
  SPACES: ["admin", "spaces"] as const,
  SPACE_MEMBERS: ["admin", "space-members"] as const,
  AUDIT: ["admin", "audit"] as const,
  HEALTH: ["admin", "health"] as const,
  REALTIME: ["admin", "realtime"] as const,
} as const;
