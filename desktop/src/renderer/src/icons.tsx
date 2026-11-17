import type { ReactElement } from 'react'

/**
 * Fixed inline-SVG icon set (UI-SPEC "No icon dependency"). `currentColor`,
 * `aria-hidden`, and always paired with a text label or an accessible name on
 * the control — never the sole carrier of meaning.
 */
interface IconProps {
  size?: number
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false
  }
}

export function PlayIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StopIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg {...base(size)}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ClearIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function GearIcon({ size = 20 }: IconProps): ReactElement {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  )
}

export function CloseIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function AlertIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M12 3l9 16H3l9-16z" />
      <path d="M12 10v5M12 18h.01" />
    </svg>
  )
}
