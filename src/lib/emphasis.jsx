import React from 'react';

/**
 * Owner-written headings mark italics with asterisks:
 * "Four floors, *one long afternoon*" → the starred words in italics.
 */
export const emphasis = (text) =>
  text.split('*').map((part, k) => (k % 2 ? <i key={k} className="italic">{part}</i> : part));
