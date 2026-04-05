// Custom type declarations for react-router v5.
// Overrides @types/react-router to avoid JSX element type mismatches.

import type { ComponentType, ReactNode } from 'react';

export interface RouteComponentProps<Params = Record<string, string>> {
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

interface PromptProps {
  message: string | ((location: any, action: string) => string | boolean);
  when?: boolean;
}

export function withRouter<P extends RouteComponentProps>(
  component: ComponentType<P>
): ComponentType<any>;

export const Prompt: React.FC<PromptProps>;
