import React from 'react';
import { useInView } from '../hooks/useInView';

/**
 * Scroll reveal. `variant` picks the choreography:
 *   rv       — rise + fade (default)
 *   rv-mask  — clip-path curtain, for images and rules
 *   rv-img   — pairs with .plate, eases the photo down from 1.14
 *
 * The curtain lives on an inner element, never on the observed one:
 * an element clipped to zero height reports an intersection ratio of
 * 0, so a self-clipping reveal can never trigger itself.
 */
export default function Reveal({
  children,
  variant = 'rv',
  className = '',
  delay = 0,
  as: Tag = 'div',
  style,
  ...rest
}) {
  const [ref, inView] = useInView();
  const cls = `${variant} ${inView ? 'in' : ''} ${className}`.replace(/\s+/g, ' ').trim();

  return (
    <Tag ref={ref} className={cls} style={{ transitionDelay: `${delay}ms`, ...style }} {...rest}>
      {variant === 'rv-mask' ? <span className="rv-curtain">{children}</span> : children}
    </Tag>
  );
}
