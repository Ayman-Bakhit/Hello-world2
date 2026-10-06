/** Hands generated text to the browser as a file. Nothing is uploaded; the filename comes from the server's validated value. */
export function downloadText(filename: string, text: string, mime: string): void {
  const safe = /^[A-Za-z0-9._-]{1,120}$/.test(filename) ? filename : "estimated-tax-report.txt";
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
