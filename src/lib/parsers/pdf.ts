import { PasswordError } from './officeCrypto';

/** A run of text on a PDF page, positioned in PDF units (origin bottom-left) */
export interface PdfItem {
  x: number;
  y: number;
  /** Right edge; numbers in statement tables are right-aligned, so this identifies their column */
  right: number;
  str: string;
}

export interface PdfLine {
  page: number;
  y: number;
  items: PdfItem[];
  text: string;
}

/** Groups items into visual lines (top to bottom, left to right) */
export function toLines(page: number, items: PdfItem[], tolerance = 2): PdfLine[] {
  const rows: { y: number; items: PdfItem[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const sorted = r.items.sort((a, b) => a.x - b.x);
      return { page, y: r.y, items: sorted, text: sorted.map((i) => i.str.trim()).join(' ') };
    });
}

/** Reads every page of a PDF as positioned lines. Throws PasswordError for locked files. */
export async function readPdfLines(data: Uint8Array, password?: string): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data, password });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as Error).name === 'PasswordException') {
      const wrong = (e as { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
      throw new PasswordError(wrong ? 'wrong' : 'required', wrong ? 'Wrong password' : 'This file is password-protected');
    }
    throw e;
  }
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const x = it.transform[4];
      items.push({ x, y: it.transform[5], right: x + it.width, str: it.str });
    }
    lines.push(...toLines(p, items));
  }
  await task.destroy();
  return lines;
}
