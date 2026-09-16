import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../lib/util';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <span className="adm-spinner" role="status" aria-label={label} />
);

const btnClass = (variant: ButtonVariant, size: 'sm' | 'md', className?: string) =>
  cx('adm-btn', `adm-btn--${variant}`, size === 'sm' && 'adm-btn--sm', className);

export function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', icon, ...rest }: ButtonProps) {
  return (
    <button type={type} className={btnClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner label="Working" /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
}

export function IconButton({ label, tone = 'default', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={cx('adm-iconbtn', tone === 'danger' && 'adm-iconbtn--danger', className)} {...rest}>
      {children}
    </button>
  );
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  /** plain <a> (downloads, external, API files) instead of a router link */
  native?: boolean;
}

export function ButtonLink({ to, variant = 'secondary', size = 'md', icon, className, children, native, ...rest }: ButtonLinkProps) {
  const cls = btnClass(variant, size, className);
  if (native) {
    return (
      <a href={to} className={cls} {...rest}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={cls} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
