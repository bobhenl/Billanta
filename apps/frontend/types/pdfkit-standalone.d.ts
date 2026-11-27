// pdfkit's browser bundle (fonts, zlib and Buffer included). Only the class is
// handed to cz-compliance's renderer, which keeps its own pdfkit typing.
declare module 'pdfkit/js/pdfkit.standalone' {
  const PDFDocument: new (options?: object) => unknown;
  export default PDFDocument;
}
