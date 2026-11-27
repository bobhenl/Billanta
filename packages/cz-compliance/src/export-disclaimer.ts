/**
 * Caveat carried inside generated filing and estimate files, so it travels
 * with the file when it is forwarded to an accountant or opened months
 * later. Czech only: the files are Czech filings read by Czech offices.
 */
export const EXPORT_DISCLAIMER =
  "Soubor vytvořila aplikace Billanta z údajů v ní zadaných. Má jen informativní charakter, je bez záruky a nenahrazuje daňového poradce ani účetní. Před podáním všechny údaje ověřte; za obsah podání odpovídáte vy.";

/**
 * Puts the caveat as an XML comment right after the prolog. Comments are
 * allowed there by the XML spec (Misc after XMLDecl) and XSD validation
 * ignores them, so EPO and the ČSSZ ePortál read the file as before.
 * "--" is not allowed inside a comment, hence the replace.
 */
export function withXmlDisclaimer(xml: string, text = EXPORT_DISCLAIMER): string {
  const comment = `<!-- ${text.replace(/-{2,}/g, "–").replace(/-$/, "–")} -->`;
  const prolog = /^<\?xml[^?]*\?>\r?\n?/.exec(xml);
  if (!prolog) return `${comment}\n${xml}`;
  return `${prolog[0].trimEnd()}\n${comment}\n${xml.slice(prolog[0].length)}`;
}
