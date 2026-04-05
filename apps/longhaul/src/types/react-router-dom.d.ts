// Custom type declarations for react-router-dom v5.
// Overrides @types/react-router-dom to avoid JSX element type mismatches
// caused by @types/react@19 incompatibility with class-based components.

import type { ReactNode } from 'react';

interface HashRouterProps {
  basename?: string;
  getUserConfirmation?: (message: string, callback: (result: boolean) => void) => void;
  hashType?: 'slash' | 'noslash' | 'hashbang';
  children?: ReactNode;
}

interface RouteProps {
  path?: string | string[];
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
  component?: React.ComponentType<any>;
  render?: (props: any) => ReactNode;
  children?: ReactNode | ((props: any) => ReactNode);
}

interface SwitchProps {
  location?: any;
  children?: ReactNode;
}

interface RedirectProps {
  to: string | { pathname: string; search?: string; hash?: string; state?: any };
  push?: boolean;
  from?: string;
  exact?: boolean;
  strict?: boolean;
}

interface LinkProps<S = unknown> {
  to: string | { pathname: string; search?: string; hash?: string; state?: S };
  replace?: boolean;
  innerRef?: React.Ref<HTMLAnchorElement>;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}

export const HashRouter: React.FC<HashRouterProps>;
export const BrowserRouter: React.FC<HashRouterProps>;
export const Switch: React.FC<SwitchProps>;
export const Route: React.FC<RouteProps>;
export const Redirect: React.FC<RedirectProps>;
export const Link: React.FC<LinkProps>;
export const NavLink: React.FC<LinkProps & { activeClassName?: string; activeStyle?: React.CSSProperties }>;

export function useHistory(): any;
export function useLocation(): any;
export function useParams<T = Record<string, string>>(): T;
export function useRouteMatch(path?: string | string[]): any;
