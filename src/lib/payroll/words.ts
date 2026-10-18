/** Amount in words with Indian numbering (crore, lakh, thousand). */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}

function belowThousand(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

export function integerInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("integerInWords expects a non-negative integer");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** "Rupees Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  return `${neg ? "Minus " : ""}Rupees ${integerInWords(r)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
}
