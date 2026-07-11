'use client';

import { useMemo, useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { Button } from '@/components/ui/button';
import { MediaIcon } from '@/components/rag/shared';
import { ClipboardList, Upload, Download, Sparkles, AlertTriangle } from 'lucide-react';

// SMART FORM FILLING (Build 3.29). A fillable PDF (AcroForm) carries named,
// typed fields — pdf-lib reads them HERE in the browser, the server answers
// each field from the wired sources (/api/fill-form, 3 credits), and pdf-lib
// writes the values back locally. The PDF itself never leaves this tab; only
// field names/labels/options are sent.

interface ParsedField {
  name: string;
  type: string;
  label?: string;
  options?: string[];
}

type Stage = 'idle' | 'parsed' | 'filling' | 'done';

export default function FormsPage() {
  const { media, activeProject } = useRag();
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [fileName, setFileName] = useState('');
  const [fields, setFields] = useState<ParsedField[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState('');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  const indexedMedia = useMemo(
    () =>
      media.filter(
        (m) => m.status === 'indexed' && activeProject.sourceIds.includes(m.id)
      ),
    [media, activeProject]
  );

  async function onFile(file: File) {
    setError('');
    setStage('idle');
    setFields([]);
    setValues({});
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      pdfBytesRef.current = bytes;
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const form = doc.getForm();
      const parsed: ParsedField[] = form.getFields().map((f) => {
        const name = f.getName();
        const ctor = f.constructor.name;
        const type = ctor.includes('CheckBox')
          ? 'checkbox'
          : ctor.includes('Dropdown')
            ? 'dropdown'
            : ctor.includes('RadioGroup')
              ? 'radio'
              : ctor.includes('OptionList')
                ? 'optionlist'
                : 'text';
        let options: string[] | undefined;
        try {
          if (type === 'dropdown' || type === 'optionlist' || type === 'radio') {
            options = (f as unknown as { getOptions: () => string[] }).getOptions();
          }
        } catch {
          /* radio groups without options */
        }
        return { name, type, options };
      });
      if (parsed.length === 0) {
        setError(
          'This PDF has no fillable fields (it is a flat/scanned form). Smart filling needs a true fillable PDF.'
        );
        return;
      }
      setFileName(file.name);
      setFields(parsed);
      setSelected(new Set(indexedMedia.map((m) => m.id)));
      setStage('parsed');
    } catch {
      setError('Could not read that PDF. Is the file intact?');
    }
  }

  async function fill() {
    setStage('filling');
    setError('');
    try {
      const r = await fetch('/api/fill-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields,
          source_ids: [...selected],
          extra_text: pasted
        })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.values) {
        setError(j?.error ?? 'Filling failed. Try again.');
        setStage('parsed');
        return;
      }
      setValues(j.values);
      setEvidence(j.evidence ?? {});
      setStage('done');
    } catch {
      setError('Connection hiccup — your form is untouched. Try again.');
      setStage('parsed');
    }
  }

  async function download() {
    if (!pdfBytesRef.current) return;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(pdfBytesRef.current, { ignoreEncryption: true });
      const form = doc.getForm();
      for (const f of fields) {
        const v = values[f.name];
        if (v === undefined || v === '') continue;
        try {
          if (f.type === 'checkbox') {
            const cb = form.getCheckBox(f.name);
            if (v === true || String(v).toLowerCase() === 'true') cb.check();
            else cb.uncheck();
          } else if (f.type === 'dropdown') {
            form.getDropdown(f.name).select(String(v));
          } else if (f.type === 'radio') {
            form.getRadioGroup(f.name).select(String(v));
          } else if (f.type === 'optionlist') {
            form.getOptionList(f.name).select(String(v));
          } else {
            form.getTextField(f.name).setText(String(v));
          }
        } catch {
          /* a single stubborn field never blocks the rest */
        }
      }
      const out = await doc.save();
      const buf = new ArrayBuffer(out.length);
      new Uint8Array(buf).set(out);
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '') + ' (filled).pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError('Could not write the filled PDF.');
    }
  }

  const filledCount = Object.values(values).filter((v) => v !== '' && v !== false).length;

  return (
    <div className="h-full p-2.5">
      <div className="panel h-full overflow-hidden rounded-[26px]">
        <div className="scroll-clean h-full overflow-y-auto px-6 py-6 lg:px-8">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <ClipboardList className="h-5 w-5 text-accent" /> Form filling
          </h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
            Upload a fillable PDF and pair it with your indexed documents (or pasted
            data) — every field gets answered from your sources. Your PDF never
            leaves this browser; a fill uses 3 question credits.
          </p>

          {/* 3.30: steps 1 + 2 sit SIDE BY SIDE on wide screens — the old
              stacked cards left the whole right half of the page empty. */}
          <div className="mt-4 grid items-start gap-3 lg:grid-cols-2">
          {/* Step 1 — the form */}
          <div className="card-glass rounded-[18px] p-4">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              1 · The form
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="outline" className="gap-2 rounded-xl" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> Choose fillable PDF
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
              {fileName && stage !== 'idle' && (
                <span className="text-[13px]">
                  <strong>{fileName}</strong>{' '}
                  <span className="text-muted-foreground">· {fields.length} fields detected</span>
                </span>
              )}
            </div>
          </div>

          {/* Step 2 — the data */}
          {stage !== 'idle' && (
            <div className="card-glass rounded-[18px] p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                2 · The data source
              </div>
              {indexedMedia.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {indexedMedia.map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={(e) => {
                          const n = new Set(selected);
                          if (e.target.checked) n.add(m.id);
                          else n.delete(m.id);
                          setSelected(n);
                        }}
                      />
                      <MediaIcon type={m.type} size="sm" />
                      <span className="truncate">{m.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  No indexed documents in this project — paste the data below instead.
                </p>
              )}
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="…or paste the data here (names, addresses, dates — anything the form asks for)"
                className="mt-3 h-24 w-full rounded-[12px] border border-border bg-card p-3 text-[13px] outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/40"
              />
              <Button
                className="mt-3 gap-2 rounded-xl"
                disabled={stage === 'filling' || (selected.size === 0 && !pasted.trim())}
                onClick={fill}
              >
                <Sparkles className="h-4 w-4" />
                {stage === 'filling' ? 'Filling…' : 'Fill the form (3 credits)'}
              </Button>
            </div>
          )}
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-[14px] bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {/* Step 3 — review + download */}
          {stage === 'done' && (
            <div className="card-glass mt-3 rounded-[18px] p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  3 · Review — {filledCount} of {fields.length} fields filled
                </div>
                <Button className="gap-2 rounded-xl" onClick={download}>
                  <Download className="h-4 w-4" /> Download filled PDF
                </Button>
              </div>
              {/* Two columns on wide screens — a 30-field form shouldn't be a
                  narrow ribbon down an empty page (3.30). */}
              <div className="mt-3 grid gap-x-8 gap-y-1.5 xl:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.name} className="flex items-center gap-3 text-[13px]">
                    <div className="w-56 shrink-0 truncate text-muted-foreground" title={f.name}>
                      {f.name}
                    </div>
                    {f.type === 'checkbox' ? (
                      <input
                        type="checkbox"
                        checked={values[f.name] === true || String(values[f.name]) === 'true'}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [f.name]: e.target.checked }))
                        }
                      />
                    ) : (
                      <input
                        value={String(values[f.name] ?? '')}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                        }
                        className="h-8 min-w-0 flex-1 rounded-[10px] border border-border bg-card px-2.5 text-[13px] outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    )}
                    {evidence[f.name] && (
                      <span
                        className="max-w-[180px] truncate text-[11px] text-muted-foreground/60"
                        title={`from ${evidence[f.name]}`}
                      >
                        ← {evidence[f.name]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/60">
                Empty fields weren&apos;t found in your sources — fill them by hand above, then download.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
