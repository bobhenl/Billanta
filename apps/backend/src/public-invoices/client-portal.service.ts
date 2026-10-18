import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { computeInvoiceTotal } from "../invoices/invoice-total.util";
import { invoiceLinkOf } from "../public-links/public-link";
import { resolvePortalToken } from "../public-links/resolve";

type PortalRow = { customer_name: string; company_name: string; profile_slug: string | null; link_prefix: string | null };

type PortalDocumentRow = {
  public_token: string;
  public_key: string | null;
  invoice_number: string | null;
  document_type: string;
  status: string;
  issue_date: string | Date | null;
  due_date: string | Date | null;
  currency: string;
  amount_paid: string | null;
  reverse_charge: boolean;
  client_response: "accepted" | "rejected" | null;
  line_items: { quantity: string; unitPrice: string; vatRate: string | null; discountPercent: string | null }[];
};

export interface ClientPortalDocument {
  /** The document's /i/ link segment (prefix + key, or the UUID of a row without a key). */
  token: string;
  number: string | null;
  documentType: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  /** Still to pay; 0 for quotes, credit notes, paid and cancelled documents. */
  balance: number;
  overdue: boolean;
  clientResponse: "accepted" | "rejected" | null;
}

export interface ClientPortalView {
  customerName: string;
  companyName: string;
  documents: ClientPortalDocument[];
  /** Outstanding balance per currency. */
  outstanding: { currency: string; amount: number; overdue: number }[];
}

const iso = (v: string | Date | null) => (v == null ? null : new Date(v).toISOString());

/** Read-only, unauthenticated per-customer portal behind contacts.portal_token. */
@Injectable()
export class ClientPortalService {
  constructor(private readonly dbService: DbService) {}

  /** `link` is the /c/ segment: a short key behind the customer's name, or the UUID of an older link. */
  async find(link: string): Promise<ClientPortalView> {
    const token = await resolvePortalToken(this.dbService.db, link);
    if (!token) throw new NotFoundException("Portal not found");
    const [head] = await this.dbService.db.execute<PortalRow>(sql`SELECT * FROM get_client_portal(${token})`);
    if (!head) throw new NotFoundException("Portal not found");
    const rows = await this.dbService.db.execute<PortalDocumentRow>(sql`SELECT * FROM get_client_portal_documents(${token})`);
    // The same links the company's e-mails carry, built from the same setting.
    const linkTenant = {
      companyName: head.company_name,
      publicProfile: { slug: head.profile_slug },
      invoiceFormPrefs: { publicLinkPrefix: head.link_prefix },
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const documents = rows.map((r): ClientPortalDocument => {
      const total = computeInvoiceTotal(r.line_items, { reverseCharge: r.reverse_charge });
      const amountPaid = Number(r.amount_paid ?? 0);
      const payable = (r.document_type === "invoice" || r.document_type === "proforma") && r.status === "issued";
      const balance = payable ? Math.max(0, Math.round((total - amountPaid) * 100) / 100) : 0;
      return {
        token: invoiceLinkOf(linkTenant, { publicKey: r.public_key, publicToken: r.public_token, invoiceNumber: r.invoice_number }),
        number: r.invoice_number,
        documentType: r.document_type,
        status: r.status,
        issueDate: iso(r.issue_date),
        dueDate: iso(r.due_date),
        currency: r.currency,
        total,
        amountPaid,
        balance,
        overdue: balance > 0 && r.due_date != null && new Date(r.due_date) < today,
        clientResponse: r.client_response,
      };
    });

    const byCurrency = new Map<string, { currency: string; amount: number; overdue: number }>();
    for (const d of documents) {
      if (d.balance <= 0) continue;
      const acc = byCurrency.get(d.currency) ?? { currency: d.currency, amount: 0, overdue: 0 };
      acc.amount += d.balance;
      if (d.overdue) acc.overdue += d.balance;
      byCurrency.set(d.currency, acc);
    }
    const outstanding = [...byCurrency.values()].map((o) => ({ ...o, amount: Math.round(o.amount * 100) / 100, overdue: Math.round(o.overdue * 100) / 100 }));

    return { customerName: head.customer_name, companyName: head.company_name, documents, outstanding };
  }
}
