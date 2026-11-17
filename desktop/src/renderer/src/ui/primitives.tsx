import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

/**
 * Hand-rolled UI primitives (UI-SPEC "Component Inventory"). Every interactive
 * primitive defines default / hover / active / focus-visible / disabled /
 * loading states in `styles/app.css`; loading dims via `aria-busy` + spinner.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  const classes = ['og-btn', `og-btn--${variant}`, loading ? 'og-btn--loading' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="og-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'muted'

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
}

export function Badge({ tone = 'neutral', children }: BadgeProps): ReactElement {
  return <span className={`og-badge og-badge--${tone}`}>{children}</span>
}

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps): ReactElement {
  return (
    <label className="og-toggle">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="og-toggle__track" aria-hidden="true">
        <span className="og-toggle__thumb" />
      </span>
      {label ? <span className="og-toggle__label">{label}</span> : null}
    </label>
  )
}

export interface SegmentedOption {
  value: string
  label: string
  disabled?: boolean
  reason?: string
}

export interface SegmentedControlProps {
  options: SegmentedOption[]
  value: string
  onChange: (next: string) => void
  name: string
  ariaLabel?: string
  disabled?: boolean
}

/**
 * Native radio group (arrow keys move within the group for free); the disabled
 * reason is surfaced via `title` for options the provider does not offer.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  name,
  ariaLabel,
  disabled
}: SegmentedControlProps): ReactElement {
  return (
    <div className="og-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <label
          key={option.value}
          className="og-segmented__option"
          title={option.disabled ? option.reason : undefined}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled || option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
