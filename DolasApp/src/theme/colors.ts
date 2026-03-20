// Trucker-Friendly High Contrast Theme
export const colors = {
  // Primary Colors - Bold and Clear
  primary: '#FF6B35',        // High-visibility orange
  primaryDark: '#D95427',
  primaryLight: '#FF8F66',

  // Status Colors - Clear Visual Indicators
  pending: '#FDB813',        // Bright yellow
  inTransit: '#2E86DE',      // Strong blue
  delivered: '#10AC84',      // Clear green
  cancelled: '#EE5A6F',      // Alert red

  // Background Colors
  background: '#FFFFFF',
  backgroundDark: '#1a1a2e',
  backgroundLight: '#F5F5F5',

  // Text Colors - High Contrast
  textPrimary: '#1a1a2e',
  textSecondary: '#4A4A4A',
  textLight: '#FFFFFF',
  textDisabled: '#9E9E9E',

  // UI Elements
  border: '#E0E0E0',
  borderDark: '#BDBDBD',
  shadow: '#000000',

  // Semantic Colors
  success: '#10AC84',
  warning: '#FDB813',
  error: '#EE5A6F',
  info: '#2E86DE',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const fontSize = {
  small: 14,
  medium: 16,
  large: 18,    // Minimum for Trucker Mode
  xlarge: 22,
  xxlarge: 28,
  huge: 36,
};

export const borderRadius = {
  small: 4,
  medium: 8,
  large: 12,
  xl: 16,
};

// Minimum touch target size for trucker-friendly UI
export const touchTarget = {
  minHeight: 48,
  minWidth: 48,
};
