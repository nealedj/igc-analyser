/**
 * File input: drag and drop, click to browse, or paste.
 *
 * The file is read with the File API and never leaves the browser. There is no
 * backend to send it to, which is the point, and the UI says so where a pilot
 * will read it rather than in a footnote.
 */

import { h } from './dom.ts';

export interface DropzoneOptions {
  onFile: (name: string, text: string) => void;
  onError: (message: string) => void;
}

/** IGC files are ASCII; latin1 keeps stray high bytes from becoming U+FFFD. */
function readAsLatin1(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(`could not read ${file.name}`));
    r.onload = () => resolve(String(r.result));
    r.readAsText(file, 'ISO-8859-1');
  });
}

export function dropzone(opts: DropzoneOptions): HTMLElement {
  const input = h('input', {
    type: 'file',
    accept: '.igc,.IGC,text/plain',
    class: 'visually-hidden',
    id: 'file-input',
  }) as HTMLInputElement;

  const zone = h(
    'div',
    { class: 'dropzone', tabindex: '0', role: 'button', 'aria-describedby': 'drop-help' },
    h('p', { class: 'drop-main' }, 'Drop an IGC file here'),
    h('p', { class: 'drop-sub' }, 'or ', h('label', { for: 'file-input', class: 'link' }, 'choose a file'), ' - .igc from any logger'),
    input,
  );

  async function take(file: File | undefined | null): Promise<void> {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      opts.onError(`${file.name} is ${(file.size / 1e6).toFixed(0)} MB, which is far larger than any IGC file.`);
      return;
    }
    try {
      opts.onFile(file.name, await readAsLatin1(file));
    } catch (e) {
      opts.onError(e instanceof Error ? e.message : String(e));
    }
  }

  input.addEventListener('change', () => void take(input.files?.[0]));
  zone.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName !== 'LABEL') input.click();
  });
  zone.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'dragend']) {
    zone.addEventListener(type, () => zone.classList.remove('over'));
  }
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    void take((e as DragEvent).dataTransfer?.files?.[0]);
  });

  // Dropping anywhere on the page is what people actually try.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === 'drop') void take((e as DragEvent).dataTransfer?.files?.[0]);
    });
  }

  return zone;
}
