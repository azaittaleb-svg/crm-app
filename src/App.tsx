import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { Layout } from './components';
import { useAuth } from './context/AuthContext';

// Synchronous login for immediate entry
import LoginPage from './pages/LoginPage';

// Lazy-loaded pages for optimal bundle splitting and performance
const HomePage = lazy(() => import('./pages/HomePage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const ExpenseDetailsPage = lazy(() => import('./pages/ExpenseDetailsPage'));
const ExpenseAnalyticsPage = lazy(() => import('./pages/ExpenseAnalyticsPage'));
const ExpenseTemplatesPage = lazy(() => import('./pages/ExpenseTemplatesPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const AddClientPage = lazy(() => import('./pages/AddClientPage'));
const EditClientPage = lazy(() => import('./pages/EditClientPage'));
const ClientDetailsPage = lazy(() => import('./pages/ClientDetailsPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const AddSupplierPage = lazy(() => import('./pages/AddSupplierPage'));
const EditSupplierPage = lazy(() => import('./pages/EditSupplierPage'));
const SupplierDetailsPage = lazy(() => import('./pages/SupplierDetailsPage'));
const SupplierPurchasesPage = lazy(() => import('./pages/SupplierPurchasesPage'));
const AddSupplierPurchasePage = lazy(() => import('./pages/AddSupplierPurchasePage'));
const SupplierPurchaseDetailsPage = lazy(() => import('./pages/SupplierPurchaseDetailsPage'));
const EditSupplierPurchasePage = lazy(() => import('./pages/EditSupplierPurchasePage'));
const DownloadAttachmentPage = lazy(() => import('./pages/DownloadAttachmentPage'));
const DevisPage = lazy(() => import('./pages/DevisPage'));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'));
const FacturationPage = lazy(() => import('./pages/FacturationPage'));
const AddPurchasePage = lazy(() => import('./pages/AddPurchasePage'));
const EditPurchasePage = lazy(() => import('./pages/EditPurchasePage'));
const PurchaseDetailsPage = lazy(() => import('./pages/PurchaseDetailsPage'));
const PartnersBalancePage = lazy(() => import('./pages/PartnersBalancePage'));
const ComptabilitePage = lazy(() => import('./pages/ComptabilitePage'));
const RapprochementPage = lazy(() => import('./pages/RapprochementPage'));
const BankImportPage = lazy(() => import('./pages/BankImportPage'));
const ReturnsNotesPage = lazy(() => import('./pages/ReturnsNotesPage'));
const AddReturnsNotePage = lazy(() => import('./pages/AddReturnsNotePage'));
const CreditNotesPage = lazy(() => import('./pages/CreditNotesPage'));
const AddCreditNotePage = lazy(() => import('./pages/AddCreditNotePage'));
const CreditNoteDetailsPage = lazy(() => import('./pages/CreditNoteDetailsPage'));
const StaffAdvanceDetailsPage = lazy(() => import('./pages/StaffAdvanceDetailsPage'));
const ZakatPage = lazy(() => import('./pages/ZakatPage'));
const ZakatDetailsPage = lazy(() => import('./pages/ZakatDetailsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const WooCommerceOrdersPage = lazy(() => import('./pages/WooCommerceOrdersPage'));

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <div className="w-10 h-10 border-3 border-[#696cff] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">
          Chargement du module...
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <Main />
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function LayoutWrapper() {
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

function Main() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 border-4 border-[#696cff] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">
            Initialisation du système...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<LayoutWrapper />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/expenses/details/:name" element={<ExpenseDetailsPage />} />
        <Route path="/expenses/analytics" element={<ExpenseAnalyticsPage />} />
        <Route path="/expenses/templates" element={<ExpenseTemplatesPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/add-client" element={<AddClientPage />} />
        <Route path="/edit-client/:id" element={<EditClientPage />} />
        <Route path="/client/:id" element={<ClientDetailsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/add-supplier" element={<AddSupplierPage />} />
        <Route path="/edit-supplier/:id" element={<EditSupplierPage />} />
        <Route path="/supplier/:id" element={<SupplierDetailsPage />} />
        <Route path="/purchases-suppliers" element={<SupplierPurchasesPage />} />
        <Route path="/add-supplier-purchase/:supplierId?" element={<AddSupplierPurchasePage />} />
        <Route
          path="/supplier-purchase/:supplierId/:purchaseId"
          element={<SupplierPurchaseDetailsPage />}
        />
        <Route
          path="/edit-supplier-purchase/:supplierId/:purchaseId"
          element={<EditSupplierPurchasePage />}
        />
        <Route path="/devis" element={<DevisPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/facturation" element={<FacturationPage />} />
        <Route path="/add-purchase" element={<AddPurchasePage />} />
        <Route path="/edit-purchase/:clientId/:purchaseId" element={<EditPurchasePage />} />
        <Route path="/purchase/:clientId/:purchaseId" element={<PurchaseDetailsPage />} />
        <Route path="/balances" element={<PartnersBalancePage />} />
        <Route path="/comptabilite" element={<ComptabilitePage />} />
        <Route path="/rapprochement" element={<RapprochementPage />} />
        <Route path="/rapprochement/import" element={<BankImportPage />} />
        <Route path="/returns-notes" element={<ReturnsNotesPage />} />
        <Route path="/add-returns-note" element={<AddReturnsNotePage />} />
        <Route path="/credit-notes" element={<CreditNotesPage />} />
        <Route path="/credit-notes/create/:clientId/:invoiceId" element={<AddCreditNotePage />} />
        <Route path="/credit-notes/:clientId/:creditNoteId" element={<CreditNoteDetailsPage />} />
        <Route path="/staff-advance/:templateId" element={<StaffAdvanceDetailsPage />} />
        <Route path="/zakat" element={<ZakatPage />} />
        <Route path="/zakat/:templateId" element={<ZakatDetailsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/woocommerce" element={<WooCommerceOrdersPage />} />
      </Route>
      <Route
        path="/download/:type/:clientId/:purchaseId"
        element={
          <Suspense fallback={<PageLoader />}>
            <DownloadAttachmentPage />
          </Suspense>
        }
      />
    </Routes>
  );
}
