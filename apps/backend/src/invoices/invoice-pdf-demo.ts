type Lang = "cs" | "sk" | "en";

/** The diagonal stamp on every page of a demo company's PDF. */
export function demoWatermarkText(lang: Lang): string {
  return lang === "en" ? "DEMO – invalid document" : "DEMO – neplatný doklad";
}

/** The small line above the footer: the stamp alone could be cropped off. */
export function demoFooterText(lang: Lang): string {
  return {
    cs: "Ukázkový doklad z dema Billanta s vymyšlenými údaji. Nejde o daňový doklad.",
    sk: "Ukážkový doklad z dema Billanta s vymyslenými údajmi. Nejde o daňový doklad.",
    en: "Sample document from the Billanta demo with made-up data. Not a tax document.",
  }[lang];
}

/**
 * Stamps every buffered page; call it last, after everything else is drawn,
 * so the stamp sits on top. `font` is the body font the service registered
 * (it has the Czech diacritics).
 */
export function drawDemoWatermark(doc: PDFKit.PDFDocument, lang: Lang, font: string): void {
  const stamp = demoWatermarkText(lang);
  const footer = demoFooterText(lang);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { width, height } = doc.page;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.save();
    doc.rotate(-35, { origin: [width / 2, height / 2] });
    // At 35° a line through the centre leaves the page at the side edges, so
    // the page width bounds how long the stamp may be.
    doc.font(font).fontSize(60);
    const room = (0.8 * width) / Math.cos((35 * Math.PI) / 180);
    const size = Math.min(60, (60 * room) / doc.widthOfString(stamp));
    doc.fontSize(size).fillColor("#dc2626").fillOpacity(0.15);
    const w = doc.widthOfString(stamp);
    doc.text(stamp, width / 2 - w / 2, height / 2 - size / 2, { lineBreak: false });
    doc.restore();

    doc.font(font).fontSize(7.5).fillColor("#dc2626").fillOpacity(1);
    doc.text(footer, 50, height - 44, { width: width - 100, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.fillColor("black");
}
