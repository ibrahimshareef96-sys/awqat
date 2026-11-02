/** ISBNs from a barcode, a Goodreads export or typing: cleaned and checked by their check digit. */

function valid10(isbn: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = isbn[i];
    const digit = ch === "X" ? 10 : Number(ch);
    if (ch === "X" && i !== 9) return false;
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

function valid13(isbn: string): boolean {
  const sum = [...isbn].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

/** The ISBN's digits (and a final X for ISBN-10), or null when it is not a valid ISBN. */
export function cleanIsbn(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^0-9X]/g, "");
  if (/^\d{13}$/.test(s)) return valid13(s) ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) return valid10(s) ? s : null;
  return null;
}

/** An ISBN-10 as ISBN-13 (978 prefix, new check digit); an ISBN-13 unchanged. */
export function toIsbn13(isbn: string): string {
  if (isbn.length === 13) return isbn;
  const body = `978${isbn.slice(0, 9)}`;
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}
