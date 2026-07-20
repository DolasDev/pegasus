// Pegasus theme — aligned to the tenant web app's color scheme.
//
// The tenant web app (apps/tenant-web) uses the shadcn/ui "slate" palette,
// defined as HSL CSS variables in apps/tenant-web/src/globals.css. The values
// below are the hex equivalents of that palette (light mode), so the driver
// app reads as the same product.
//
// Order-status colors are Tailwind 500/600 swatches — the web app does not
// define semantic status colors, so we use the Tailwind ramp shadcn is built
// on, picking shades that keep text legible on each badge.
export const colors = {
  // Primary — tenant `--primary` (slate-900) family
  primary: '#0F172A', // slate-900 (tenant --primary)
  primaryDark: '#020817', // slate-950 (tenant --foreground / --ring)
  primaryLight: '#1E293B', // slate-800

  // Status Colors - Clear Visual Indicators
  pending: '#F59E0B', // amber-500
  inTransit: '#3B82F6', // blue-500
  delivered: '#16A34A', // green-600
  cancelled: '#EF4444', // red-500 (tenant --destructive)

  // Background Colors
  background: '#FFFFFF', // tenant --background
  backgroundDark: '#0F172A', // slate-900 dark surface
  backgroundLight: '#F1F5F9', // slate-100 (tenant --secondary / --muted / --accent)

  // Text Colors
  textPrimary: '#0F172A', // slate-900 (tenant --foreground family)
  textSecondary: '#64748B', // slate-500 (tenant --muted-foreground)
  textLight: '#F8FAFC', // slate-50 (tenant --primary-foreground)
  textDisabled: '#94A3B8', // slate-400

  // UI Elements
  border: '#E2E8F0', // slate-200 (tenant --border / --input)
  borderDark: '#CBD5E1', // slate-300
  shadow: '#000000',

  // Semantic Colors
  success: '#16A34A', // green-600
  warning: '#F59E0B', // amber-500
  error: '#EF4444', // red-500 (tenant --destructive)
  info: '#3B82F6', // blue-500
}
