// Validates UBL documents against the OASIS UBL 2.1 XSD with the JDK's own
// validator. Schematron does not check element order or cardinality, and an
// access point rejects a document that is not schema-valid before it runs
// any business rule.
//
// Run as a single-file source program (JDK 11+):
//   java XsdValidate.java <UBL-2.1.zip> <document.xml>...
// Prints one tab-separated line per problem: file, line, message.
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import javax.xml.XMLConstants;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXParseException;

public class XsdValidate {
  public static void main(String[] args) throws Exception {
    // The schemas are read straight out of the official zip; their relative
    // imports resolve inside it.
    String zip = "jar:" + new File(args[0]).toURI() + "!/xsd/maindoc/";
    SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
    Map<String, Schema> schemas = new HashMap<>();
    schemas.put("Invoice", factory.newSchema(new URL(zip + "UBL-Invoice-2.1.xsd")));
    schemas.put("CreditNote", factory.newSchema(new URL(zip + "UBL-CreditNote-2.1.xsd")));

    for (int i = 1; i < args.length; i++) {
      File file = new File(args[i]);
      String name = file.getName();
      Schema schema = schemas.get(rootName(file));
      if (schema == null) {
        System.out.println(name + "\t0\tUnknown root element " + rootName(file));
        continue;
      }
      Validator validator = schema.newValidator();
      validator.setErrorHandler(new ErrorHandler() {
        public void warning(SAXParseException e) {}
        public void error(SAXParseException e) { report(name, e); }
        public void fatalError(SAXParseException e) { report(name, e); }
      });
      try {
        validator.validate(new StreamSource(file));
      } catch (SAXParseException e) {
        // Already reported through the handler.
      }
    }
  }

  static void report(String name, SAXParseException e) {
    System.out.println(name + "\t" + e.getLineNumber() + ":" + e.getColumnNumber() + "\t" + e.getMessage());
  }

  static String rootName(File file) throws Exception {
    try (InputStream in = new FileInputStream(file)) {
      XMLStreamReader reader = XMLInputFactory.newInstance().createXMLStreamReader(in);
      while (!reader.isStartElement()) reader.next();
      return reader.getLocalName();
    }
  }
}
