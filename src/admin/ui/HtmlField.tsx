import { useState } from 'react';
import { Textarea } from './form';

const PREVIEW_CSS = `body{margin:0;padding:16px;font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,sans-serif;color:#0c0b0a;background:#f2ede6}
h1,h2,h3{font-family:'Instrument Serif',serif;font-weight:400;line-height:1.1}img{max-width:100%;height:auto}a{color:#c4522c}`;

/**
 * HTML textarea with a preview. The preview renders in a sandboxed iframe
 * (no scripts, no same-origin access) so pasted markup cannot run in the admin.
 */
export function HtmlField({ label, value, onChange, error, rows = 10 }: { label: string; value: string; onChange: (v: string) => void; error?: string; rows?: number }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="adm-htmlfield">
      <div className="adm-htmlfield__switch" role="group" aria-label={`${label} view`}>
        <button type="button" className="adm-seg" aria-pressed={!preview} onClick={() => setPreview(false)}>
          HTML
        </button>
        <button type="button" className="adm-seg" aria-pressed={preview} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="adm-field">
          <span className="adm-field__label">{label} — preview</span>
          <iframe className="adm-preview" title={`${label} preview`} sandbox="" srcDoc={`<!doctype html><style>${PREVIEW_CSS}</style>${value}`} />
        </div>
      ) : (
        <Textarea label={label} value={value} rows={rows} error={error} className="adm-code" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
