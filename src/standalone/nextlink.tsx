/* Shim for `next/link` in the standalone browser build. The terminal's
   components are written against Next's router; in the single-file build there
   is no router, so links become hash navigation over the same URL shapes. */
import type { ReactNode, AnchorHTMLAttributes } from 'react';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  children: ReactNode;
}

export default function Link({ href, children, ...rest }: LinkProps) {
  return (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  );
}
