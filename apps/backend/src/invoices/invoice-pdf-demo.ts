type Lang = "cs" | "sk" | "en";
/** A practice company of a class is a demo company too, with its own wording. */
export type DemoVariant = "demo" | "classroom" | "draft";

/** The diagonal stamp on every page of a demo company's PDF. */
export function demoWatermarkText(lang: Lang, variant: DemoVariant = "demo"): string {
  // A draft's preview: not issued yet, so it must not pass for the real document.
  if (variant === "draft") return { cs: "NÁHLED – nevystaveno", sk: "NÁHĽAD – nevystavené", en: "PREVIEW – not issued" }[lang];
  if (variant === "classroom") return { cs: "CVIČNÝ – neplatný doklad", sk: "CVIČNÝ – neplatný doklad", en: "PRACTICE – invalid document" }[lang];
  return lang === "en" ? "DEMO – invalid document" : "DEMO – neplatný doklad";
}

/** The small line above the footer: the stamp alone could be cropped off. */
export function demoFooterText(lang: Lang, variant: DemoVariant = "demo"): string {
  if (variant === "draft")
    return {
      cs: "Náhled konceptu. Číslo dokladu a QR platba přibudou při vystavení. Nejde o daňový doklad.",
      sk: "Náhľad konceptu. Číslo dokladu a QR platba pribudnú pri vystavení. Nejde o daňový doklad.",
      en: "Draft preview. The document number and payment QR code are added when it is issued. Not a tax document.",
    }[lang];
  if (variant === "classroom")
    return {
      cs: "Cvičný doklad ze školní výuky v Billantě s vymyšlenými údaji. Nejde o daňový doklad.",
      sk: "Cvičný doklad zo školskej výučby v Billante s vymyslenými údajmi. Nejde o daňový doklad.",
      en: "Practice document from a Billanta school class with made-up data. Not a tax document.",
    }[lang];
  return {
    cs: "Ukázkový doklad z dema Billanta s vymyšlenými údaji. Nejde o daňový doklad.",
    sk: "Ukážkový doklad z dema Billanta s vymyslenými údajmi. Nejde o daňový doklad.",
    en: "Sample document from the Billanta demo with made-up data. Not a tax document.",
  }[lang];
}
