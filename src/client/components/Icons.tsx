interface IconProps {
  readonly className?: string;
}

/** Inline SVG rather than an icon font or emoji: sharp at any size, no payload. */
export function CopyIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M4.5 12.5 10 18 19.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
