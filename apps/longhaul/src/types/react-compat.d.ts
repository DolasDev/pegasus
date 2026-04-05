// Fix for @types/react@19 incompatibilities with libraries typed against React 18.
//
// @types/react@19 includes `bigint` in ReactNode but older @types/react-router-dom
// and react-modal types reference the React 18 ReactNode (without bigint), causing
// "cannot be used as a JSX component" errors. This augmentation aligns the types.

import 'react';

declare module 'react' {
  // Allow the `margin` attribute on HTML elements (used on <i> tags in this codebase)
  interface HTMLAttributes<T> {
    margin?: string;
  }
}

// Override react-router-dom v5 exports to bypass JSX element type mismatches
declare module 'react-router-dom' {
  import type { ComponentType, ReactNode } from 'react';

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
    component?: ComponentType<any>;
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
}

declare module 'react-router' {
  import type { ComponentType, ReactNode } from 'react';

  interface PromptProps {
    message: string | ((location: any, action: string) => string | boolean);
    when?: boolean;
  }

  interface RouteComponentProps<Params = Record<string, string>> {
    match: {
      params: Params;
      isExact: boolean;
      path: string;
      url: string;
    };
    location: {
      pathname: string;
      search: string;
      hash: string;
      state: any;
      key?: string;
    };
    history: {
      push(path: string, state?: any): void;
      replace(path: string, state?: any): void;
      go(n: number): void;
      goBack(): void;
      goForward(): void;
      listen(callback: (location: any, action: string) => void): () => void;
      length: number;
      action: string;
      location: any;
    };
    staticContext?: any;
  }

  export function withRouter<P extends RouteComponentProps>(
    component: ComponentType<P>
  ): ComponentType<Omit<P, keyof RouteComponentProps>>;

  export const Prompt: React.FC<PromptProps>;
  export type { RouteComponentProps };
}

// Override react-modal for JSX compatibility
declare module 'react-modal' {
  import type { ReactNode } from 'react';

  interface ModalProps {
    isOpen: boolean;
    onRequestClose?: (event: React.MouseEvent | React.KeyboardEvent) => void;
    onAfterOpen?: () => void;
    onAfterClose?: () => void;
    style?: { content?: React.CSSProperties; overlay?: React.CSSProperties };
    contentLabel?: string;
    appElement?: HTMLElement;
    ariaHideApp?: boolean;
    shouldCloseOnOverlayClick?: boolean;
    shouldCloseOnEsc?: boolean;
    className?: string | { base: string; afterOpen: string; beforeClose: string };
    overlayClassName?: string | { base: string; afterOpen: string; beforeClose: string };
    children?: ReactNode;
    [key: string]: any;
  }

  const Modal: React.FC<ModalProps> & {
    setAppElement(element: string | HTMLElement): void;
  };

  export default Modal;
}

export {};
