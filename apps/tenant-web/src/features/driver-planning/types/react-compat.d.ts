// Fix for @types/react@19 incompatibilities with libraries typed against React 18.
//
// @types/react@19 includes `bigint` in ReactNode but older @types/react-router-dom
// and react-modal types reference the React 18 ReactNode (without bigint), causing
// "cannot be used as a JSX component" errors. This augmentation aligns the types.

import 'react'

declare module 'react' {
  // Allow the `margin` attribute on HTML elements (used on <i> tags in this codebase)
  interface HTMLAttributes<T> {
    margin?: string
  }
}

// Override react-modal for JSX compatibility
declare module 'react-modal' {
  import type { ReactNode } from 'react'

  interface ModalProps {
    isOpen: boolean
    onRequestClose?: (event: React.MouseEvent | React.KeyboardEvent) => void
    onAfterOpen?: () => void
    onAfterClose?: () => void
    style?: { content?: React.CSSProperties; overlay?: React.CSSProperties }
    contentLabel?: string
    appElement?: HTMLElement
    ariaHideApp?: boolean
    shouldCloseOnOverlayClick?: boolean
    shouldCloseOnEsc?: boolean
    className?: string | { base: string; afterOpen: string; beforeClose: string }
    overlayClassName?: string | { base: string; afterOpen: string; beforeClose: string }
    children?: ReactNode
    [key: string]: any
  }

  const Modal: React.FC<ModalProps> & {
    setAppElement(element: string | HTMLElement): void
  }

  export default Modal
}

// Override @radix-ui/react-dialog for JSX compatibility with @types/react@19
declare module '@radix-ui/react-dialog' {
  import type { ReactNode, CSSProperties, HTMLAttributes, RefAttributes } from 'react'

  interface DialogProps {
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?(open: boolean): void
    modal?: boolean
    children?: ReactNode
  }

  interface DialogPortalProps {
    container?: HTMLElement | null
    forceMount?: true
    children?: ReactNode
  }

  interface DialogOverlayProps
    extends HTMLAttributes<HTMLDivElement>, RefAttributes<HTMLDivElement> {
    asChild?: boolean
    forceMount?: true
  }

  interface DialogContentProps
    extends HTMLAttributes<HTMLDivElement>, RefAttributes<HTMLDivElement> {
    asChild?: boolean
    forceMount?: true
    onOpenAutoFocus?(event: Event): void
    onCloseAutoFocus?(event: Event): void
    onEscapeKeyDown?(event: KeyboardEvent): void
    onPointerDownOutside?(event: any): void
    onInteractOutside?(event: any): void
  }

  interface DialogTitleProps
    extends HTMLAttributes<HTMLHeadingElement>, RefAttributes<HTMLHeadingElement> {
    asChild?: boolean
  }

  interface DialogCloseProps
    extends HTMLAttributes<HTMLButtonElement>, RefAttributes<HTMLButtonElement> {
    asChild?: boolean
  }

  export const Root: React.FC<DialogProps>
  export const Portal: React.FC<DialogPortalProps>
  export const Overlay: React.FC<DialogOverlayProps>
  export const Content: React.FC<DialogContentProps>
  export const Title: React.FC<DialogTitleProps>
  export const Close: React.FC<DialogCloseProps>
}

export {}
