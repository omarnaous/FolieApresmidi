import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconMenu = (p: IconProps) => base(p, <path d="M3 7h18M3 12h18M3 17h18" />);
export const IconClose = (p: IconProps) => base(p, <path d="M6 6l12 12M18 6L6 18" />);
export const IconPlus = (p: IconProps) => base(p, <path d="M12 5v14M5 12h14" />);
export const IconChevronLeft = (p: IconProps) => base(p, <path d="M15 6l-6 6 6 6" />);
export const IconChevronRight = (p: IconProps) => base(p, <path d="M9 6l6 6-6 6" />);
export const IconChevronUp = (p: IconProps) => base(p, <path d="M6 15l6-6 6 6" />);
export const IconChevronDown = (p: IconProps) => base(p, <path d="M6 9l6 6 6-6" />);
export const IconArrowUp = (p: IconProps) => base(p, <path d="M12 19V5M6 11l6-6 6 6" />);
export const IconArrowDown = (p: IconProps) => base(p, <path d="M12 5v14M6 13l6 6 6-6" />);
export const IconExternal = (p: IconProps) => base(p, <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />);
export const IconTrash = (p: IconProps) => base(p, <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const IconUpload = (p: IconProps) => base(p, <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />);
export const IconCopy = (p: IconProps) => base(p, <><rect x="9" y="9" width="11" height="11" rx="1" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>);
export const IconPrint = (p: IconProps) => base(p, <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />);
export const IconEdit = (p: IconProps) => base(p, <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />);
export const IconHistory = (p: IconProps) => base(p, <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>);