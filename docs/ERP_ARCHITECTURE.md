# ERP System Architecture & Workflow Design

This document details the complete, robust, and Odoo-inspired ERP architecture for the Firestore-based business management system. It ensures data consistency, strict sequential numbering, non-repudiation of invoices, and comprehensive auditability.

---

## 1. Complete System Architecture

The architecture relies on a **server-driven state machine** executing on top of Firestore. 
To guarantee ACID properties and prevent race conditions (especially for sequential numbering), all major state transitions (e.g., Quote $\to$ Order, Order $\to$ Invoice, Invoice Validation) are executed inside atomic **Firestore Transactions (`runTransaction`)**.

### Principles
- **Immutability of Validated Records:** Once an invoice is validated, its amount, date, and items are frozen.
- **Traceability:** Every state transition triggers the insertion of a structured Audit Log in the same transaction.
- **Strict Sequences:** Invoice numbers are never recycled.
- **Chronological Integrity:** Anti-backdating enforces continuous chronological order for legal/accounting compliance.

---

## 2. Firestore Collections Design

The structure is hierarchical, centering around the user (tenant/organization) to provide secure multi-tenancy rules.

```text
users/{uid}
├── customers/{customerId}
│   ├── name, email, vatNumber, address
│   ├── quotes/{quoteId}
│   ├── orders/{orderId}
│   └── invoices/{invoiceId}
│       └── auditLogs/{logId}  (Subcollection for granular history)
│
├── sequences/{sequenceId}
│   // sequenceId: e.g., 'INV_2026'
│   // { current: 15, prefix: 'INV', year: 2026, updatedAt: Timestamp }
│
├── accounting/settings
│   // Document tracking the global accounting locks
│   // { lastInvoiceDate: Timestamp, lockDate: Timestamp }
│
└── auditLogs/{logId} // Global audit logs
```

*(Note: In the current system, standardizing on global root collections per tenant, e.g., `invoices` globally with `customerId` references, or keeping them under `customers/{id}/purchases`, both work. Odoo prefers global `account.move` with partner relations.)*

---

## 3. State Machine Diagrams

### Quotation Flow
```text
[ Brouillon ] ⇄ [ Envoyé ]
      ↓
  [ Accepté ] ─ OR ─ [ Refusé ]
```
* Transitions: Draft $\to$ Sent, Sent $\to$ Accepted, Accepted $\to$ Draft (if revision needed before order).

### Sales Order Flow
```text
[ Brouillon ] ⟶ [ Confirmée ] ⟶ [ Annulée ]
```
* Note: A confirmed order cannot revert to draft. It must be cancelled. Cancelled orders can be duplicated to a new draft.

### Invoice Flow
```text
[ Brouillon ] ⟶ [ Validée ] ⟶ [ Annulée ]
```
* Note: Invoice Numbers are generated **only** upon transitioning to `Validée`.

---

## 4. Full Business Algorithms

### Flow A: The Standard ERP Pipeline
1. **Creation:** A Quotation is created (Draft).
2. **Acceptance:** Customer approves. Status $\to$ `Accepté`.
3. **Conversion:** Quotation generates a Sales Order (`Confirmée`).
4. **Billing:** Sales Order generates an Invoice (`Brouillon`). The invoice holds a reference to the source Order ID.
5. **Validation:** User triggers validation on Invoice $\to$ System assigns Sequence Number $\to$ Status becomes `Validée`.

### Flow B: Direct Invoice
1. Quotation generated and accepted.
2. Direct push to Invoice (`Brouillon`) bypassing Sales Order.
3. Validation executes.

---

## 5. Invoice Validation Algorithm

Executing securely inside `runTransaction(db, async (t) => { ... })`:

1. **Read Lock:** Read the Invoice Document.
2. **State Check:** Ensure current status `=== 'Brouillon'`. If not, throw Error.
3. **Accounting Check:** Execute Anti-Backdating Algorithm (see below).
4. **Sequence Lock:** Read the sequence tracker document (`sequences/INV_YYYY`).
5. **Increment:** Calculate `nextNumber = current + 1`.
6. **Generate String:** Format number (e.g., `INV/2026/000001`).
7. **Mutate Invoice:** 
   - `status` = 'Validée'
   - `invoiceNumber` = `INV/2026/000001`
   - `validatedAt` = `serverTimestamp()`
8. **Mutate Sequence:** Write `nextNumber` back to sequence document.
9. **Mutate Accounting:** Update `lastInvoiceDate` to the current invoice's date.
10. **Audit Log:** Write validation log.

---

## 6. Anti-Backdating Algorithm

A strict requirement for legal compliance (cannot issue invoice #5 on Jan 10th if invoice #4 was issued Jan 12th).

```typescript
const accountingRef = doc(db, 'users', uid, 'accounting', 'settings');
const accountingSnap = await transaction.get(accountingRef);

const invoiceDate = invoiceData.date.toMillis();
const lastInvoiceDate = accountingSnap.exists() ? accountingSnap.data().lastInvoiceDate.toMillis() : 0;

if (invoiceDate < lastInvoiceDate) {
    throw new Error("Anti-backdating violation: Invoice date cannot be earlier than the last validated invoice.");
}

// Proceed to update
transaction.set(accountingRef, { lastInvoiceDate: invoiceData.date }, { merge: true });
```

---

## 7. Number Generation Algorithm

Numbers must be visually distinct, sequential, and rigidly formatted.

```typescript
function formatSequence(prefix: string, year: number, seq: number, length: number = 6): string {
    const paddedSeq = String(seq).padStart(length, '0');
    return `${prefix}/${year}/${paddedSeq}`; // e.g. INV/2026/000001
}
```

- When the year changes, a new sequence document `sequences/INV_2027` is initialized tracking from `0`.

---

## 8. Cancellation Algorithm

**Rule: Never delete a validated invoice. Never recycle its number.**

```typescript
// Inside Transaction:
if (invoice.status !== 'Validée') throw new Error("Only validated invoices can be cancelled.");

// Soft Cancel
transaction.update(invoiceRef, {
    status: 'Annulée',
    cancelledAt: serverTimestamp(),
    cancellationReason: reason
});

// Issue Audit Log
transaction.set(auditLogRef, { action: 'CANCEL', ... });
```

The invoice remains in reports (with 0.00 recognizable revenue if configured, or acting as a voided record) to prove continuity of sequence to auditors.

---

## 9. Audit Log Algorithm

Every action pushes a standardized payload:

```typescript
interface AuditLog {
    userId: string;
    actionType: 'CREATE' | 'UPDATE' | 'VALIDATE' | 'CANCEL' | 'CONVERT_TO_ORDER';
    entityType: 'QUOTE' | 'ORDER' | 'INVOICE';
    entityId: string;
    timestamp: FieldValue;
    beforeSnapshot: Partial<EntityData> | null;
    afterSnapshot: Partial<EntityData>;
}
```

Inserted concurrently within the triggering transaction to ensure it is inextricably linked to the commit.

---

## 10. Firestore Security Strategy

Implemented in `firestore.rules`:

```javascript
match /users/{uid}/invoices/{invoiceId} {
    // Drafts are editable
    allow update: if resource.data.status == 'Brouillon';
    
    // Validated invoices map block field updates except status transitions to Cancelled
    allow update: if resource.data.status == 'Validée' 
                  && request.resource.data.status == 'Annulée'
                  && request.resource.data.invoiceNumber == resource.data.invoiceNumber
                  && request.resource.data.amount == resource.data.amount;

    // Hard delete forbidden unless it's a Draft
    allow delete: if resource.data.status == 'Brouillon';
}
```

---

## 11. Production-Ready TypeScript Backend Architecture

```typescript
// Core Service Architecture
// src/services/erp/
// ├── QuotationService.ts
// ├── SalesOrderService.ts
// ├── InvoiceService.ts        <-- Houses the transactional runTransaction logic
// ├── SequenceService.ts       <-- Manages atomic increments
// └── AuditLogger.ts           <-- Standardizes log formation

class InvoiceService {
    async validateInvoice(invoiceId: string, invoiceDate: Date): Promise<void> {
        // Implementation of Algorithm #5 & #6
    }
    async cancelInvoice(invoiceId: string, reason: string): Promise<void> {
        // Implementation of Algorithm #8
    }
}
```

---

## 12. Best Practices Inspired by Odoo

1. **State-Driven UI:** UI buttons ("Validate", "Cancel") appear dynamically based exclusively on the current document `status`.
2. **Never Overwrite the Past:** Corrections require a new document (Credit Note / Avoir) or Cancellation + Recreation. Modification of historical validated states is forbidden.
3. **Traceability:** Every converted document (Quote $\to$ Order) stores an `originId` (e.g., `origin: 'QUOTE-001'`). Clicking "Source Document" in the UI takes you backwards in the flow.
4. **Draft as a Sandbox:** Users are encouraged to stay in the `Brouillon` (Draft) state as long as necessary. Draft numbering can use localized formatting (e.g., `*000001` or `DRAFT`) to prevent confusion with official sequences.
