// Custom type declarations for react-modal.
// Overrides @types/react-modal to avoid JSX element type mismatches.

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

declare const Modal: React.FC<ModalProps> & {
  setAppElement(element: string | HTMLElement): void;
};

export default Modal;
