'use client';

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import { Spinner } from '../feedback/Spinner.js';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly loading?: boolean;
  readonly leftIcon?: ReactNode;
  readonly rightIcon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export type ButtonProps =
  | (CommonProps &
      Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
        href?: undefined;
      })
  | (CommonProps &
      Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & { href: string });

/**
 * The one button component for the whole app. Renders an `<a>` when `href`
 * is given (a link styled as a button is still a link — correct semantics
 * for keyboard/screen-reader users), a `<button>` otherwise.
 */
export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    leftIcon,
    rightIcon,
    children,
    className,
    href,
    ...rest
  } = props;

  const classes = cx(
    styles['button'],
    styles[`variant-${variant}`],
    styles[`size-${size}`],
    fullWidth && styles['fullWidth'],
    loading && styles['loading'],
    className,
  );
  const content = (
    <>
      {loading ? (
        <span className={styles['spinnerSlot']}>
          <Spinner size={size === 'sm' ? 14 : 16} label="Chargement…" />
        </span>
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </>
  );

  if (href !== undefined) {
    return (
      <a
        href={href}
        className={classes}
        data-dj-button=""
        aria-disabled={loading || undefined}
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      type="button"
      className={classes}
      data-dj-button=""
      disabled={loading || buttonRest.disabled}
      {...buttonRest}
    >
      {content}
    </button>
  );
}
