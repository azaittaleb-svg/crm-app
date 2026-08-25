import { APP_VERSION } from '../constants';
import { ReactNode, useState, useEffect, useRef, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  ShoppingBag,
  UserCircle,
  Truck,
  Package,
  Receipt,
  Scale,
  Heart,
  Settings,
  LogOut,
  RefreshCw,
  Search,
  HelpCircle,
  ChevronDown,
  X,
  Sparkles,
  Command,
  ArrowRight,
  Menu,
  ChevronLeft,
  ChevronRight,
  HeartCrack,
  Layers,
  Plus,
  MessageSquare,
  Copy,
  ArrowLeft,
  Printer,
  Edit3,
  Check,
  Globe,
  Sun,
  Moon,
  FileText,
  Calculator,
  Upload,
  Download,
  ShoppingCart,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { auth, db } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { NotificationBell } from './NotificationBell';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const purchaseGearRef = useRef<HTMLDivElement>(null);

  const isClientsPage = location.pathname === '/clients';
  const isPurchasesPage = location.pathname === '/purchases';
  const isSuppliersPage = location.pathname === '/suppliers';
  const isSupplierPurchasesPage = location.pathname === '/purchases-suppliers';
  const isReturnsNotesPage = location.pathname === '/returns-notes';
  const isExpensesPage = location.pathname === '/expenses';
  const isZakatPage = location.pathname === '/zakat';
  const isAddPurchasePage = location.pathname === '/add-purchase';
  const isEditPurchasePage = location.pathname.startsWith('/edit-purchase/');
  const isPurchaseDetailsPage = location.pathname.startsWith('/purchase/');
  const isCreditNoteDetailsPage = location.pathname.startsWith('/credit-notes/') && location.pathname.split('/').length === 4 && location.pathname.split('/')[2] !== 'create';

  const isClientDetailsPage = location.pathname.startsWith('/client/');
  const isSupplierDetailsPage =
    location.pathname.startsWith('/supplier/') &&
    !location.pathname.startsWith('/supplier-purchase/');
  const isSupplierPurchaseDetailsPage = location.pathname.startsWith('/supplier-purchase/');
  const isEditSupplierPurchasePage = location.pathname.startsWith('/edit-supplier-purchase/');

  const supplierPurchasePaths =
    isSupplierPurchaseDetailsPage || isEditSupplierPurchasePage ? location.pathname.split('/') : [];
  const supplierId = supplierPurchasePaths[2];
  const purchaseId = supplierPurchasePaths[3];

  const editPurchasePaths = isEditPurchasePage ? location.pathname.split('/') : [];
  const editClientId = editPurchasePaths[2];
  const editPurchaseId = editPurchasePaths[3];

  const isDashboard = location.pathname === '/';
  const isSettings = location.pathname === '/settings';
  const isDashboardOrSettings = isDashboard || isSettings;
  const hideHeaderSearch = true;

  const getPageTitle = (path: string) => {
    if (path === '/add-purchase') {
      const type = new URLSearchParams(location.search).get('type');
      if (type === 'devis') return 'Nouveau Devis';
      if (type === 'facture') return 'Nouvelle Facture';
      return 'Nouvelle Vente';
    }
    if (path.startsWith('/edit-purchase/')) {
      const type = new URLSearchParams(location.search).get('type');
      if (type === 'devis') return 'Modifier le Devis';
      if (type === 'facture') return 'Modifier la Facture';
      return 'Modifier la Vente';
    }
    if (path.startsWith('/edit-client/')) {
      return 'Modifier le Client';
    }
    if (path.startsWith('/edit-supplier/')) {
      return 'Modifier le Fournisseur';
    }
    if (path.startsWith('/credit-notes/') && path.split('/').length === 4 && path.split('/')[2] !== 'create') {
      return "Détails de l'Avoir";
    }
    if (path.startsWith('/purchase/')) {
      if (resolvedDocType === 'devis') return 'Détails du Devis';
      if (resolvedDocType === 'facture') return 'Détails de la Facture';
      return 'Détails de la Commande';
    }
    switch (path) {
      case '/':
        return 'Tableau de bord';
      case '/clients':
        return 'Clients (Profils)';
      case '/add-client':
        return 'Ajouter un client';
      case '/devis':
        return 'Devis (Offres)';
      case '/purchases':
        return 'Commandes (Bons)';
      case '/facturation':
        return 'Facturation (Ventes)';
      case '/credit-notes':
        return 'Avoirs (Notes de crédit)';
      case '/suppliers':
        return 'Fournisseurs';
      case '/add-supplier':
        return 'Ajouter un fournisseur';
      case '/purchases-suppliers':
        return 'Achats';
      case '/add-supplier-purchase':
        return 'Nouveau lot / achat fournisseur';
      case '/expenses':
        return 'Dépenses';
      case '/expenses/templates':
        return 'Modèles de charges';
      case '/expenses/analytics':
        return 'Analyses des dépenses';
      case '/comptabilite':
        return 'Comptabilité';
      case '/zakat':
        return 'Zakat';
      case '/balances':
        return 'Balances';
      case '/rapprochement':
        return 'Rapprochement bancaire & espèces';
      case '/returns-notes':
        return 'Retours';
      case '/settings':
        return 'Paramètres du système';
      default:
        return 'Finexy';
    }
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [purchaseGearOpen, setPurchaseGearOpen] = useState(false);

  // Theme State (Persisted in Local Storage, dark mode support matching Sneat)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark') return 'dark';
      if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    } catch (_) {
      return 'light';
    }
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);

  // Sneat Sidebar Hover & Pin States (Persisted in Local Storage)
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebarPinned');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (_) {
      return true;
    }
  });
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const isExpanded = sidebarPinned || sidebarHovered;

  // Dynamic stats & search records
  const [clients, setClients] = useState<any[]>([]);
  const clientId =
    isClientDetailsPage || isPurchaseDetailsPage || isEditPurchasePage || isCreditNoteDetailsPage
      ? location.pathname.split('/')[2]
      : null;
  const currentClient = clientId ? clients.find((c: any) => c.id === clientId) : null;
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const supplierDetailsId = isSupplierDetailsPage ? location.pathname.split('/')[2] : null;
  const currentSupplier = supplierDetailsId
    ? suppliers.find((s: any) => s.id === supplierDetailsId)
    : null;
  const [searchResults, setSearchResults] = useState<
    { type: string; name: string; path: string }[]
  >([]);

  const activePurchaseId =
    isPurchaseDetailsPage || isEditPurchasePage ? location.pathname.split('/')[3] : null;
  const activeCreditNoteId =
    isCreditNoteDetailsPage ? location.pathname.split('/')[3] : null;

  // Real-time purchases for currentClient to calculate exact balance in header
  const [currentClientPurchases, setCurrentClientPurchases] = useState<any[]>([]);

  useEffect(() => {
    if (!user || !clientId) {
      setCurrentClientPurchases([]);
      return;
    }

    const q = query(
      collection(db, 'clients', clientId, 'purchases'),
      where('ownerId', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCurrentClientPurchases(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      () => {}
    );
    return unsub;
  }, [user, clientId]);

  const [currentSupplierPurchases, setCurrentSupplierPurchases] = useState<any[]>([]);

  useEffect(() => {
    if (!user || !supplierDetailsId) {
      setCurrentSupplierPurchases([]);
      return;
    }

    const q = query(
      collection(db, 'suppliers', supplierDetailsId, 'purchases'),
      where('ownerId', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCurrentSupplierPurchases(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      () => {}
    );
    return unsub;
  }, [user, supplierDetailsId]);

  const activePurchase = useMemo(() => {
    if (!activePurchaseId) return null;
    return currentClientPurchases.find((p: any) => p.id === activePurchaseId);
  }, [currentClientPurchases, activePurchaseId]);

  const resolvedDocType = useMemo(() => {
    const queryType = new URLSearchParams(location.search).get('type');
    if (queryType === 'devis' || queryType === 'facture' || queryType === 'commande') {
      return queryType;
    }
    if (activePurchase?.type) {
      return activePurchase.type;
    }
    return 'commande';
  }, [location.search, activePurchase]);

  const currentClientBalance = useMemo(() => {
    const totalVentes = currentClientPurchases.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
    const totalPaid = currentClientPurchases.reduce(
      (acc, p) => acc + (Number(p.amountPaid) || 0),
      0
    );
    return totalVentes - totalPaid;
  }, [currentClientPurchases]);

  const currentSupplierBalance = useMemo(() => {
    const totalPurchases = currentSupplierPurchases.reduce(
      (acc, p) => acc + (Number(p.total) || 0),
      0
    );
    const totalPaid = currentSupplierPurchases.reduce(
      (acc, p) =>
        acc +
        (p.amountPaid !== undefined
          ? Number(p.amountPaid) || 0
          : p.paymentStatus === 'paid'
            ? Number(p.total) || 0
            : 0),
      0
    );
    return totalPurchases - totalPaid;
  }, [currentSupplierPurchases]);

  // Sidebar count badges
  const [clientCount, setClientCount] = useState<number>(0);
  const [pendingExpensesCount, setPendingExpensesCount] = useState<number>(0);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Logout error', e);
    }
  };

  // Close profile dropdown if clicked outside
  useEffect(() => {
    function clickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
      if (purchaseGearRef.current && !purchaseGearRef.current.contains(e.target as Node)) {
        setPurchaseGearOpen(false);
      }
    }
    document.addEventListener('mousedown', clickOutside);
    return () => document.removeEventListener('mousedown', clickOutside);
  }, []);

  // Keyboard shortcut listener for Command+K or '/' to search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Subscribe to live records for dynamic badges and search utility
  useEffect(() => {
    if (!user) return;

    // Clients subscription
    const clientQuery = query(collection(db, 'clients'), where('ownerId', '==', user.uid));
    const unsubClients = onSnapshot(clientQuery, (snap) => {
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setClients(items);
      setClientCount(items.length);
    });

    // Suppliers subscription
    const supplierQuery = query(collection(db, 'suppliers'), where('ownerId', '==', user.uid));
    const unsubSuppliers = onSnapshot(supplierQuery, (snap) => {
      setSuppliers(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    // Expenses count with templates filtering
    let latestExpenses: any[] = [];
    let latestTemplates: any[] = [];

    const recalculatePendingCount = () => {
      let filtered = latestExpenses.filter((e: any) => {
        if (e.deleted) return false;
        return true;
      });

      // Clean, simple visual grouping method without complex auto-merging:
      const nameGroups = new Map<string, any[]>();

      for (const exp of filtered) {
        const nameKey =
          (exp.name || '')
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase() ||
          exp.templateId ||
          exp.id ||
          '';
        if (!nameGroups.has(nameKey)) {
          nameGroups.set(nameKey, []);
        }
        nameGroups.get(nameKey)!.push(exp);
      }

      let _pendingCount = 0;

      for (const list of nameGroups.values()) {
        const paid = list.filter((e) => e.status === 'PAID');
        const pending = list.filter((e) => e.status !== 'PAID');

        // If there are no paid instances, show exactly one pending instance visually
        if (paid.length === 0 && pending.length > 0) {
          _pendingCount++;
        }
      }

      setPendingExpensesCount(_pendingCount);
    };

    const templatesQuery = query(
      collection(db, 'expense_templates'),
      where('ownerId', '==', user.uid)
    );
    const unsubTemplates = onSnapshot(templatesQuery, (snap) => {
      latestTemplates = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      recalculatePendingCount();
    });

    const currentMonthYear = new Date().toISOString().slice(0, 7);
    const expensesQuery = query(
      collection(db, 'expenses'),
      where('ownerId', '==', user.uid),
      where('monthYear', '==', currentMonthYear)
    );
    const unsubExpenses = onSnapshot(expensesQuery, (snap) => {
      // Filter out Zakat
      latestExpenses = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as any)
        .filter((e) => !(e.name || '').toLowerCase().includes('zakat'));
      recalculatePendingCount();
    });

    return () => {
      unsubClients();
      unsubSuppliers();
      unsubTemplates();
      unsubExpenses();
    };
  }, [user]);

  // Search logic
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const queryLower = searchQuery.toLowerCase();
    const results: { type: string; name: string; path: string }[] = [];

    const navigationList = [
      { name: 'Tableau de bord', path: '/' },
      { name: 'Clients (Profils)', path: '/clients' },
      { name: 'Ajouter un client', path: '/add-client' },
      { name: 'Ventes', path: '/purchases' },
      { name: 'Ajouter une vente', path: '/add-purchase' },
      { name: 'Fournisseurs', path: '/suppliers' },
      { name: 'Ajouter un fournisseur', path: '/add-supplier' },
      { name: 'Achats', path: '/purchases-suppliers' },
      { name: 'Nouveau lot / achat fournisseur', path: '/add-supplier-purchase' },
      { name: 'Dépenses', path: '/expenses' },
      { name: 'Modèles de charges', path: '/expenses/templates' },
      { name: 'Analyses des dépenses', path: '/expenses/analytics' },
      { name: 'Zakat', path: '/zakat' },
      { name: 'Balances', path: '/balances' },
      { name: 'Rapprochement bancaire & espèces', path: '/rapprochement' },
      { name: 'Retours', path: '/returns-notes' },
      { name: 'Paramètres du système', path: '/settings' },
    ];

    navigationList.forEach((nav) => {
      if (nav.name.toLowerCase().includes(queryLower)) {
        results.push({ type: 'Navigation', name: nav.name, path: nav.path });
      }
    });

    clients.forEach((client: any) => {
      if ((client.name || '').toLowerCase().includes(queryLower)) {
        results.push({ type: 'Client CRM', name: client.name, path: `/client/${client.id}` });
      }
    });

    suppliers.forEach((sup: any) => {
      if ((sup.name || '').toLowerCase().includes(queryLower)) {
        results.push({ type: 'Fournisseur', name: sup.name, path: `/supplier/${sup.id}` });
      }
    });

    setSearchResults(results);
  }, [searchQuery, clients, suppliers]);

  const menuSections = [
    {
      title: 'Accueil',
      items: [{ label: 'Tableau de bord', path: '/', icon: LayoutGrid, tag: null }],
    },
    {
      title: 'Gestion Commerciale',
      items: [
        {
          label: 'Clients',
          path: '/clients',
          icon: UserCircle,
          tag: clientCount > 0 ? `${clientCount}` : null,
        },
        { label: 'Devis', path: '/devis', icon: Layers, tag: null },
        { label: 'Commandes', path: '/purchases', icon: ShoppingBag, tag: null },
        { label: 'Facturation', path: '/facturation', icon: Receipt, tag: null },
        { label: 'Avoirs', path: '/credit-notes', icon: FileText, tag: null },
        { label: 'WooCommerce', path: '/woocommerce', icon: ShoppingCart, tag: null },
        { label: 'Fournisseurs', path: '/suppliers', icon: Truck, tag: null },
        { label: 'Achats', path: '/purchases-suppliers', icon: Package, tag: null },
        { label: 'Retours', path: '/returns-notes', icon: HeartCrack, tag: null },
      ],
    },
    {
      title: 'Trésorerie & Outils',
      items: [
        {
          label: 'Dépenses',
          path: '/expenses',
          icon: Receipt,
          tag: pendingExpensesCount > 0 ? `${pendingExpensesCount}` : null,
        },
        { label: 'Comptabilité', path: '/comptabilite', icon: Calculator, tag: null },
        { label: 'Balances', path: '/balances', icon: Scale, tag: null },
        { label: 'Rapprochement', path: '/rapprochement', icon: RefreshCw, tag: null },
        { label: 'Zakat', path: '/zakat', icon: Heart, tag: null },
        { label: 'Paramètres', path: '/settings', icon: Settings, tag: null },
      ],
    },
  ];

  const isPrintMode = new URLSearchParams(location.search).get('print') === 'true';

  if (isPrintMode) {
    return (
      <div className="min-h-screen bg-[#f5f5f9] dark:bg-[#232333] font-sans text-[#435971] dark:text-[#dbdade] print:bg-white p-0 m-0">
        {children}
      </div>
    );
  }

  const getInitials = (name?: string | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Helper to determine active state of a menu link
  const isItemActive = (path: string) => {
    const current = location.pathname;
    if (path === '/') return current === '/';

    const isClientDocRoute =
      current.startsWith('/purchase/') ||
      current.startsWith('/add-purchase') ||
      current.startsWith('/edit-purchase');

    let isPurchase = false;
    let isDevisActive = false;
    let isFacturationActive = false;

    if (isClientDocRoute) {
      if (resolvedDocType === 'devis') {
        isDevisActive = path === '/devis';
      } else if (resolvedDocType === 'facture') {
        isFacturationActive = path === '/facturation';
      } else {
        isPurchase = path === '/purchases';
      }
    } else {
      isPurchase =
        path === '/purchases' &&
        (current.startsWith('/purchase/') ||
          current.startsWith('/add-purchase') ||
          current.startsWith('/edit-purchase'));
    }

    const isClient =
      path === '/clients' && (current.startsWith('/client/') || current.startsWith('/add-client'));
    const isSupplier =
      path === '/suppliers' &&
      (current.startsWith('/supplier/') || current.startsWith('/add-supplier'));
    const isSupplierPurchase =
      path === '/purchases-suppliers' &&
      (current.startsWith('/supplier-purchase/') ||
        current.startsWith('/add-supplier-purchase') ||
        current.startsWith('/edit-supplier-purchase'));

    return (
      current === path ||
      current.startsWith(path + '/') ||
      isPurchase ||
      isDevisActive ||
      isFacturationActive ||
      isClient ||
      isSupplier ||
      isSupplierPurchase
    );
  };

  return (
    <div className="flex h-screen w-screen bg-[#f4f5fa] dark:bg-[#232333] text-[#566a7f] dark:text-[#a3a4cc] font-sans overflow-hidden antialiased">
      {/* 1. DESKTOP SIDEBAR SPACER: Keeps main content stable when sidebar expands on hover */}
      <div
        className={`hidden md:block transition-all duration-300 shrink-0 ${
          sidebarPinned ? 'w-[260px]' : 'w-20'
        }`}
      />

      {/* 1. DESKTOP SIDEBAR (FIXED INNER) */}
      <aside
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        style={{ fontFamily: "'Public Sans', sans-serif" }}
        className={`hidden md:flex flex-col bg-[#ffffff] dark:bg-[#2b2c40] border-r border-[#dbdade]/60 dark:border-[#434460]/40 h-full transition-all duration-300 fixed left-0 top-0 bottom-0 select-none shrink-0 z-[49] ${
          isExpanded ? 'w-[260px]' : 'w-20'
        }`}
      >
        {/* Sneat Circular Pin Toggle Button (displayed only when expanded, absolute-positioned on the right boundary edge) */}
        {isExpanded && (
          <button
            onClick={() => {
              const nextState = !sidebarPinned;
              setSidebarPinned(nextState);
              localStorage.setItem('sidebarPinned', JSON.stringify(nextState));
            }}
            className="absolute top-[20px] right-[-18px] z-[60] w-[36px] h-[36px] rounded-full bg-[#696cff] text-white flex items-center justify-center cursor-pointer transition-transform duration-200 border-[7px] border-[#f4f5fa] dark:border-[#232333] shadow-none outline-none"
            title={sidebarPinned ? 'Désactiver le menu persistant' : 'Épingler le menu'}
          >
            <ChevronLeft
              size={18}
              strokeWidth={2.5}
              className={`transition-transform duration-300 ${!sidebarPinned ? 'rotate-180' : ''}`}
            />
          </button>
        )}

        {/* Sidebar Header (Sneat Brand style) */}
        <div className="flex items-center shrink-0 h-[64px] overflow-hidden relative w-full">
          <div className="w-[260px] flex items-center px-6 gap-3">
            <div className="w-[34px] h-[34px] rounded-lg bg-[#696cff] flex items-center justify-center shadow-[0_2px_6px_rgba(105,108,255,0.45)] shrink-0">
              <svg
                width="24"
                height="24"
                viewBox="0 0 25 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-white"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12.38 2.25c-.23 0-.46.03-.68.1L6.7 4.07c-1 .35-1.5 1.45-1.15 2.45L8.7 15.5c.35 1 1.45 1.5 2.45 1.15l5-1.72c1-.35 1.5-1.45 1.15-2.45l-3.15-8.98c-.35-1-1.45-1.5-2.45-1.15l-.32.11z"
                  fill="currentColor"
                  fillOpacity="0.4"
                />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M14.63 7.25c-.23 0-.46.03-.68.1l-5 1.72c-1 .35-1.5 1.45-1.15 2.45l3.15 8.98c.35 1 1.45 1.5 2.45 1.15l5-1.72c1-.35 1.5-1.45 1.15-2.45l-3.15-8.98c-.35-1-1.45-1.5-2.45-1.15l-.32.11z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div
              className={`flex flex-col text-left transition-opacity duration-300 select-none ${isExpanded ? 'opacity-100' : 'opacity-0'}`}
            >
              <span
                className="font-sans font-extrabold text-[21px] tracking-tight text-[#435971] dark:text-[#dbdade] leading-none mb-0.5"
                style={{ letterSpacing: '-0.5px' }}
              >
                Finexy
              </span>
              <span
                className="text-[10px] font-bold uppercase tracking-widest text-[#a1acb8] dark:text-[#707194] leading-none shrink-0"
                style={{ letterSpacing: '1.2px' }}
              >
                Workspace
              </span>
            </div>
          </div>
        </div>

        {/* Navigation lists (Sneat Category / Group style with refined scrollbar) */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto no-scrollbar py-3 space-y-1 relative w-full">
          <div className="w-[260px] flex flex-col">
            {menuSections.map((section) => (
              <div key={section.title} className="space-y-0.5">
                {/* Categorization header */}
                <div className="h-[48px] flex items-center select-none relative w-full overflow-hidden">
                  <div
                    className={`absolute left-0 right-0 px-[29px] transition-opacity duration-300 text-left ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  >
                    <span className="text-[11px] font-medium text-[#a1acb8] dark:text-[#707194] uppercase tracking-wide block">
                      {section.title}
                    </span>
                  </div>
                  <div
                    className={`absolute left-0 right-0 flex justify-center transition-opacity duration-300 w-[80px] ${!isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  >
                    <div className="w-5 h-[1.5px] bg-[#e6e8eb] dark:bg-[#34354c] rounded-full" />
                  </div>
                </div>

                {/* Section items list */}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = isItemActive(item.path);
                    return (
                      <Link
                        key={item.label}
                        to={item.path}
                        className={`flex items-center h-[42px] mx-[14px] px-[15px] mb-1 rounded-[6px] transition-colors duration-150 relative group/item ${
                          isActive
                            ? 'bg-[rgba(105,108,255,0.16)] dark:bg-[rgba(105,108,255,0.16)] text-[#696cff] dark:text-[#b1b4ff]'
                            : 'text-[#697a8d] dark:text-[#a3a4cc] hover:bg-[#F5F5F9] dark:hover:bg-[#323249]/60 hover:text-[#435971] dark:hover:text-[#dbdade]'
                        }`}
                        title={!isExpanded ? item.label : undefined}
                        style={{ width: '232px' }}
                      >
                        <item.icon
                          size={22}
                          strokeWidth={isActive ? 1.7 : 1.5}
                          className={`shrink-0 transition-colors duration-150 ${isActive ? 'text-[#696cff] dark:text-[#b1b4ff]' : 'text-[#697a8d] dark:text-[#a3a4cc] group-hover/item:text-[#435971] dark:group-hover/item:text-[#dbdade]'}`}
                        />

                        <div
                          className={`flex items-center justify-between overflow-hidden whitespace-nowrap transition-opacity duration-300 ml-3 flex-1 min-w-0 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}
                        >
                          <span
                            className={`${isActive ? 'font-medium' : 'font-normal'} text-[15px] tracking-normal leading-none font-sans truncate`}
                          >
                            {item.label}
                          </span>

                          {item.tag && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm shrink-0 leading-none font-sans h-[18px] flex items-center justify-center ml-2 ${
                                isActive
                                  ? 'bg-[#696cff] dark:bg-[#b1b4ff] text-white dark:text-[#232333]'
                                  : item.label === 'Dépenses'
                                    ? 'bg-[#ffebe6] dark:bg-[rgba(255,62,29,0.12)] text-[#ff3e1d]'
                                    : 'bg-[#F5F5F9] dark:bg-[#232333] text-[#a1acb8] dark:text-[#707194]'
                              }`}
                            >
                              {item.tag}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Footer Account / Theme / Logout */}
        <div className="py-3.5 border-t border-[#dbdade]/40 dark:border-[#434460]/30 shrink-0 select-none overflow-hidden relative w-full">
          <div className="w-[260px] flex flex-col gap-2">
            {/* Profile Avatar & Theme Switcher */}
            <div
              className="mx-[14px] px-[15px] flex items-center justify-between h-[42px]"
              style={{ width: '232px' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    className="w-7 h-7 rounded-full object-cover border border-[#dbdade]/60 dark:border-[#434460]/40"
                    alt="Compte"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 bg-slate-100 dark:bg-[#323249] text-[#696cff] dark:text-[#b1b4ff] rounded-full flex items-center justify-center font-extrabold text-[10px] uppercase">
                    {getInitials(user?.displayName || user?.email)}
                  </div>
                )}
                <span
                  className={`text-[13px] font-bold text-[#435971] dark:text-[#dbdade] truncate transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                  {user?.displayName || user?.email?.split('@')[0]}
                </span>
              </div>
              <button
                onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#323249]/60 text-[#697a8d] dark:text-[#a3a4cc] transition-colors focus:outline-hidden cursor-pointer"
                title={theme === 'dark' ? 'Mode Clair' : 'Mode Sombre'}
              >
                {theme === 'dark' ? (
                  <Sun size={17} strokeWidth={1.8} />
                ) : (
                  <Moon size={17} strokeWidth={1.8} />
                )}
              </button>
            </div>

            <button
              onClick={handleLogout}
              className={`flex items-center h-[42px] mx-[14px] px-[15px] text-[#ff3e1d] hover:bg-[#ffebe6] dark:hover:bg-[rgba(255,62,29,0.12)] text-[14px] font-medium transition-colors cursor-pointer bg-transparent border-0 outline-none rounded-[6px]`}
              title={!isExpanded ? 'Se déconnecter' : undefined}
              style={{ width: '232px' }}
            >
              <LogOut size={22} strokeWidth={1.5} className="shrink-0 text-[#ff3e1d]" />
              <div
                className={`flex whitespace-nowrap transition-opacity duration-300 ml-3 flex-1 min-w-0 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}
              >
                <span className={`text-[15px] leading-none font-sans font-medium truncate`}>
                  Se déconnecter
                </span>
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* 2. MAIN VIEW AREA (Right of sidebar) */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* 3. SCROLLABLE CONTENT BODY */}
        <main
          id="main-scroll-container"
          className="flex-1 overflow-y-auto bg-[#f4f5fa] dark:bg-[#232333] custom-scrollbar print:overflow-visible print:bg-white pb-12"
        >
          {/* SLIM STICKY HEADER MODULE (Light, high-contrast Sneat cockpit layout) */}
          <header className="sticky top-0 w-full flex justify-center z-30 select-none bg-[#f4f5fa]/90 dark:bg-transparent backdrop-blur-md pt-3 pb-1">
            <div className="w-full max-w-[1468px] mx-auto px-6 md:px-10">
              <div className="w-full bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg flex items-center justify-between h-[64px] px-4 md:px-5 shadow-[0_2px_6px_rgba(15,23,42,0.02)] text-dark-text">
                {/* Left Side: Mobile Menu Trigger / Context Title / Breadcrumbs or Sneat Search */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1 mr-4">
                  {/* Mobile toggle button */}
                  <button
                    onClick={() => setMobileMenuOpen(true)}
                    className="md:hidden w-10 h-10 rounded-lg bg-slate-50 dark:bg-[#323249] hover:bg-slate-100 dark:hover:bg-[#3f405a] text-dark-text dark:text-[#dbdade] flex items-center justify-center border border-border dark:border-[#434460]/40 transition-all cursor-pointer shadow-3xs"
                  >
                    <Menu size={18} strokeWidth={2.2} />
                  </button>

                  {/* Context title / breadcrumbs */}
                  {isClientDetailsPage ? (
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 bg-slate-50 dark:bg-[#323249] border border-border dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#3f405a] transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-95 shadow-3xs"
                      >
                        <ArrowLeft
                          size={15}
                          strokeWidth={2.5}
                          className="text-[#435971] dark:text-[#dbdade]"
                        />
                      </button>
                      <div className="flex flex-col text-left min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h1 className="text-sm md:text-base font-semibold tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none truncate">
                            {currentClient?.name || 'Client'}
                          </h1>
                          {currentClient &&
                            (currentClientBalance === 0 ? (
                              <span className="text-[8px] font-extrabold bg-transparent dark:bg-transparent text-[#4fb922] dark:text-[#71dd37]  uppercase tracking-widest leading-none shrink-0 font-mono animate-fade-in">
                                Soldé
                              </span>
                            ) : (
                              <span className="text-[8px] font-extrabold bg-transparent dark:bg-transparent dark:bg-[#392e39] text-[#ffab00] dark:text-[#ffab00] dark: dark:border-[#ff9f43]/30 uppercase tracking-widest leading-none shrink-0 font-mono animate-fade-in">
                                En cours
                              </span>
                            ))}
                        </div>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[8px] font-bold font-mono uppercase tracking-wider mt-1 leading-none shrink-0">
                          ID: {clientId?.substring(0, 8).toUpperCase()}
                        </p>
                      </div>
                    </div>
                  ) : isSupplierDetailsPage ? (
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 bg-slate-50 dark:bg-[#323249] border border-border dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#3f405a] transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-95 shadow-3xs"
                      >
                        <ArrowLeft
                          size={15}
                          strokeWidth={2.5}
                          className="text-[#435971] dark:text-[#dbdade]"
                        />
                      </button>
                      <div className="flex flex-col text-left min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h1 className="text-sm md:text-base font-semibold tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none truncate">
                            {currentSupplier?.name || 'Fournisseur'}
                          </h1>
                          {currentSupplier &&
                            (currentSupplierBalance === 0 ? (
                              <span className="text-[8px] font-extrabold bg-transparent dark:bg-transparent text-[#4fb922] dark:text-[#71dd37]  uppercase tracking-widest leading-none shrink-0 font-mono animate-fade-in">
                                Soldé
                              </span>
                            ) : (
                              <span className="text-[8px] font-extrabold bg-transparent dark:bg-transparent text-[#ffab00] dark:text-[#ffab00] uppercase tracking-widest leading-none shrink-0 font-mono animate-fade-in">
                                En cours
                              </span>
                            ))}
                        </div>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[8px] font-bold font-mono uppercase tracking-wider mt-1 leading-none shrink-0">
                          ID: {supplierDetailsId?.substring(0, 8).toUpperCase()}
                        </p>
                      </div>
                    </div>
                  ) : isCreditNoteDetailsPage ? (
                    <div className="flex items-center gap-3 animate-in fade-in">
                      <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 bg-slate-50 dark:bg-[#323249] border border-border dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#3f405a] transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-95 shadow-3xs"
                      >
                        <ArrowLeft
                          size={15}
                          strokeWidth={2.5}
                          className="text-[#435971] dark:text-[#dbdade]"
                        />
                      </button>
                      <div className="flex flex-col text-left">
                        <h1 className="text-sm md:text-base font-semibold tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none">
                          Détails de l'Avoir
                        </h1>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[8px] font-bold font-mono uppercase tracking-wider mt-1 leading-none">
                          ID Document : {activeCreditNoteId?.substring(0, 8).toUpperCase() || '-'}
                        </p>
                      </div>
                    </div>
                  ) : isPurchaseDetailsPage ? (
                    <div className="flex items-center gap-3 animate-in fade-in">
                      <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 bg-slate-50 dark:bg-[#323249] border border-border dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#3f405a] transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-95 shadow-3xs"
                      >
                        <ArrowLeft
                          size={15}
                          strokeWidth={2.5}
                          className="text-[#435971] dark:text-[#dbdade]"
                        />
                      </button>
                      <div className="flex flex-col text-left">
                        <h1 className="text-sm md:text-base font-semibold tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none">
                          {resolvedDocType === 'devis'
                            ? 'Détails du Devis'
                            : resolvedDocType === 'facture'
                              ? 'Détails de la Facture'
                              : 'Détails de la Commande'}
                        </h1>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[8px] font-bold font-mono uppercase tracking-wider mt-1 leading-none">
                          ID Document : {activePurchaseId?.substring(0, 8).toUpperCase() || '-'}
                        </p>
                      </div>
                    </div>
                  ) : isSupplierPurchaseDetailsPage ? (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 bg-slate-50 dark:bg-[#323249] border border-border dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#3f405a] transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-95 shadow-3xs"
                      >
                        <ArrowLeft
                          size={15}
                          strokeWidth={2.5}
                          className="text-[#435971] dark:text-[#dbdade]"
                        />
                      </button>
                      <div className="flex flex-col text-left">
                        <h1 className="text-sm md:text-base font-semibold tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none">
                          Facturation Logistique
                        </h1>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[8px] font-bold font-mono uppercase tracking-wider mt-1 leading-none">
                          Achat & revient
                        </p>
                      </div>
                    </div>
                  ) : isEditSupplierPurchasePage ? (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 bg-slate-50 dark:bg-[#323249] border border-border dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#3f405a] transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-95 shadow-3xs"
                      >
                        <ArrowLeft
                          size={15}
                          strokeWidth={2.5}
                          className="text-[#435971] dark:text-[#dbdade]"
                        />
                      </button>
                      <div className="flex flex-col text-left">
                        <h1 className="text-sm md:text-base font-semibold tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none">
                          Modifier l'Achat Stock
                        </h1>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[8px] font-bold font-mono uppercase tracking-wider mt-1 leading-none">
                          Achat ID: {purchaseId?.substring(0, 8).toUpperCase()}
                        </p>
                      </div>
                    </div>
                  ) : isDashboard ? (
                    /* Search input on the left of header */
                    <div className="flex items-center w-full max-w-sm md:max-w-md">
                      <button
                        onClick={() => setSearchOpen(true)}
                        className="flex items-center gap-3 bg-transparent dark:bg-transparent cursor-pointer text-left w-full text-[#a1acb8] dark:text-[#707194] hover:text-[#435971] dark:hover:text-[#dbdade] transition-colors focus:outline-hidden"
                      >
                        <Search
                          size={18}
                          strokeWidth={1.8}
                          className="text-[#a1acb8] dark:text-[#707194] mr-0.5"
                        />
                        <span className="text-[14px] font-medium text-[#a1acb8] dark:text-[#707194] font-sans tracking-wide">
                          Search{' '}
                          <span className="text-slate-300 dark:text-[#707194] font-mono text-xs font-normal">
                            [{navigator.platform.indexOf('Mac') > -1 ? '⌘K' : 'Ctrl+K'}]
                          </span>
                        </span>
                      </button>
                    </div>
                  ) : (
                    /* Page Title on the left */
                    <div className="flex items-center gap-3 w-full max-w-sm md:max-w-md">
                      {location.pathname === '/clients' && (
                        <UserCircle size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/purchases' && (
                        <ShoppingBag size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/suppliers' && (
                        <Truck size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/purchases-suppliers' && (
                        <Package size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/returns-notes' && (
                        <HeartCrack size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/comptabilite' && (
                        <Calculator size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/expenses' && (
                        <Receipt size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/devis' && (
                        <FileText size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/facturation' && (
                        <Receipt size={20} className="text-[#696cff]" />
                      )}
                      {location.pathname === '/add-purchase' &&
                        (new URLSearchParams(location.search).get('type') === 'devis' ? (
                          <FileText size={20} className="text-[#696cff]" />
                        ) : new URLSearchParams(location.search).get('type') === 'facture' ? (
                          <Receipt size={20} className="text-[#696cff]" />
                        ) : (
                          <ShoppingBag size={20} className="text-[#696cff]" />
                        ))}
                      {location.pathname.startsWith('/edit-purchase/') &&
                        (new URLSearchParams(location.search).get('type') === 'devis' ? (
                          <FileText size={20} className="text-[#696cff]" />
                        ) : new URLSearchParams(location.search).get('type') === 'facture' ? (
                          <Receipt size={20} className="text-[#696cff]" />
                        ) : (
                          <ShoppingBag size={20} className="text-[#696cff]" />
                        ))}
                      <h1 className="text-xl font-bold font-sans tracking-tight text-[#435971] dark:text-[#dbdade] capitalize leading-none">
                        {getPageTitle(location.pathname)}
                      </h1>
                    </div>
                  )}
                </div>

                {/* Right Side: Page Actions & Standard Utility icons */}
                <div className="flex items-center gap-2.5 md:gap-3.5 shrink-0">
                  {/* Context Page level Buttons for precise UX */}

                  {isClientDetailsPage && (
                    <div className="flex items-center gap-1.5 select-none shrink-0 animate-in fade-in">
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('copy-client-report'))}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Copier le relevé"
                      >
                        <Copy size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => navigate(`/edit-client/${clientId}`)}
                        className="w-10 h-10 rounded-lg bg-[#696cff] border-0 text-white flex items-center justify-center hover:bg-[#5f61e6] cursor-pointer shadow-sm shadow-[#696cff]/10"
                        title="Modifier les informations"
                      >
                        <Edit3 size={16} strokeWidth={2.2} />
                      </button>
                    </div>
                  )}

                  {isSupplierDetailsPage && (
                    <div className="flex items-center gap-1.5 select-none shrink-0 animate-in fade-in">
                      <button
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent('copy-supplier-report'))
                        }
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Copier le rapport"
                      >
                        <Copy size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => navigate(`/edit-supplier/${supplierDetailsId}`)}
                        className="w-10 h-10 rounded-lg bg-[#696cff] border-0 text-white flex items-center justify-center hover:bg-[#5f61e6] cursor-pointer shadow-sm shadow-[#696cff]/10"
                        title="Modifier les informations"
                      >
                        <Edit3 size={16} strokeWidth={2.2} />
                      </button>
                    </div>
                  )}

                  {isPurchaseDetailsPage && (
                    <div className="flex items-center gap-1.5 select-none shrink-0 animate-in fade-in">
                      <button
                        onClick={() => window.print()}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Imprimer"
                      >
                        <Printer size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent('export-bl-pdf'))
                        }
                        className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/40 text-orange-600 dark:text-orange-400 flex items-center justify-center hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-all cursor-pointer shadow-3xs"
                        title="Créer Bon de Livraison (BL) PDF"
                      >
                        <Truck size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent('copy-purchase-report'))
                        }
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Copier"
                      >
                        <Copy size={16} strokeWidth={2.2} />
                      </button>
                      {resolvedDocType !== 'facture' && (
                        <button
                          onClick={() =>
                            clientId &&
                            activePurchaseId &&
                            navigate(
                              `/edit-purchase/${clientId}/${activePurchaseId}?type=${resolvedDocType}`
                            )
                          }
                          className="w-10 h-10 rounded-lg bg-[#696cff] border-0 text-white flex items-center justify-center hover:bg-[#5f61e6] cursor-pointer shadow-sm shadow-[#696cff]/10"
                          title="Modifier"
                        >
                          <Edit3 size={16} strokeWidth={2.2} />
                        </button>
                      )}
                    </div>
                  )}

                  {isSupplierPurchaseDetailsPage && (
                    <div className="flex items-center gap-1.5 select-none shrink-0 animate-in fade-in">
                      <button
                        onClick={() => window.print()}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Imprimer"
                      >
                        <Printer size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent('copy-supplier-purchase'))
                        }
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Copier"
                      >
                        <Copy size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() =>
                          navigate(`/edit-supplier-purchase/${supplierId}/${purchaseId}`)
                        }
                        className="w-10 h-10 rounded-lg bg-[#696cff] border-0 text-white flex items-center justify-center hover:bg-[#5f61e6] cursor-pointer shadow-sm shadow-[#696cff]/10"
                        title="Modifier"
                      >
                        <Edit3 size={16} strokeWidth={2.2} />
                      </button>
                    </div>
                  )}

                  {isSupplierPurchasesPage && (
                    <div className="relative flex items-center shrink-0" ref={purchaseGearRef}>
                      <button
                        onClick={() => setPurchaseGearOpen(!purchaseGearOpen)}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Options d'import / export"
                      >
                        <Settings
                          size={18}
                          strokeWidth={2.2}
                          className={`${purchaseGearOpen ? 'rotate-45' : ''} transition-transform duration-200`}
                        />
                      </button>

                      <AnimatePresence>
                        {purchaseGearOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                            className="absolute right-0 top-[44px] w-64 bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/40 rounded-xl shadow-xl z-50 overflow-hidden p-1.5 text-left text-[#435971] dark:text-[#dbdade] font-sans"
                          >
                            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#323249] border-b border-border dark:border-[#434460]/40 rounded-lg mb-1.5">
                              <p className="text-[9px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest leading-none">
                                Actions Achats
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-import-purchases'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#696cff] dark:hover:text-[#b1b4ff] hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left"
                            >
                              <Upload size={14} strokeWidth={2.2} className="text-[#696cff]" />
                              <span>Importer depuis Excel</span>
                            </button>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-import-purchases-motcho'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#696cff] dark:hover:text-[#b1b4ff] hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left"
                            >
                              <Upload size={14} strokeWidth={2.2} className="text-[#696cff]" />
                              <span>Importer achats Motcho</span>
                            </button>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-export-purchases'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left mt-0.5"
                            >
                              <Download size={14} strokeWidth={2.2} className="text-emerald-500" />
                              <span>Exporter vers Excel (XLSX)</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {isPurchasesPage && (
                    <div className="relative flex items-center shrink-0" ref={purchaseGearRef}>
                      <button
                        onClick={() => setPurchaseGearOpen(!purchaseGearOpen)}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Options d'import / export"
                      >
                        <Settings
                          size={18}
                          strokeWidth={2.2}
                          className={`${purchaseGearOpen ? 'rotate-45' : ''} transition-transform duration-200`}
                        />
                      </button>

                      <AnimatePresence>
                        {purchaseGearOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                            className="absolute right-0 top-[44px] w-64 bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/40 rounded-xl shadow-xl z-50 overflow-hidden p-1.5 text-left text-[#435971] dark:text-[#dbdade] font-sans"
                          >
                            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#323249] border-b border-border dark:border-[#434460]/40 rounded-lg mb-1.5">
                              <p className="text-[9px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest leading-none">
                                Actions Commandes
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-import-commandes'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#696cff] dark:hover:text-[#b1b4ff] hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left"
                            >
                              <Upload size={14} strokeWidth={2.2} className="text-[#696cff]" />
                              <span>Importer depuis Excel</span>
                            </button>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-export-commandes'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left mt-0.5"
                            >
                              <Download size={14} strokeWidth={2.2} className="text-emerald-500" />
                              <span>Exporter vers Excel (XLSX)</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {isExpensesPage && (
                    <div className="relative flex items-center shrink-0" ref={purchaseGearRef}>
                      <button
                        onClick={() => setPurchaseGearOpen(!purchaseGearOpen)}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Options d'import / export"
                      >
                        <Settings
                          size={18}
                          strokeWidth={2.2}
                          className={`${purchaseGearOpen ? 'rotate-45' : ''} transition-transform duration-200`}
                        />
                      </button>

                      <AnimatePresence>
                        {purchaseGearOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                            className="absolute right-0 top-[44px] w-64 bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/40 rounded-xl shadow-xl z-50 overflow-hidden p-1.5 text-left text-[#435971] dark:text-[#dbdade] font-sans"
                          >
                            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#323249] border-b border-border dark:border-[#434460]/40 rounded-lg mb-1.5">
                              <p className="text-[9px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest leading-none">
                                Actions Dépenses
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-import-expenses'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#696cff] dark:hover:text-[#b1b4ff] hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left"
                            >
                              <Upload size={14} strokeWidth={2.2} className="text-[#696cff]" />
                              <span>Importer depuis Excel</span>
                            </button>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-export-expenses'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left mt-0.5"
                            >
                              <Download size={14} strokeWidth={2.2} className="text-emerald-500" />
                              <span>Exporter vers Excel (XLSX)</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {isZakatPage && (
                    <div className="relative flex items-center shrink-0" ref={purchaseGearRef}>
                      <button
                        onClick={() => setPurchaseGearOpen(!purchaseGearOpen)}
                        className="w-10 h-10 rounded-lg bg-white dark:bg-[#323249] border border-slate-200 dark:border-[#434460]/40 text-slate-705 dark:text-[#dbdade] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#3f405a] transition-all cursor-pointer shadow-3xs"
                        title="Options d'import / export"
                      >
                        <Settings
                          size={18}
                          strokeWidth={2.2}
                          className={`${purchaseGearOpen ? 'rotate-45' : ''} transition-transform duration-200`}
                        />
                      </button>

                      <AnimatePresence>
                        {purchaseGearOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                            className="absolute right-0 top-[44px] w-64 bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/40 rounded-xl shadow-xl z-50 overflow-hidden p-1.5 text-left text-[#435971] dark:text-[#dbdade] font-sans"
                          >
                            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#323249] border-b border-border dark:border-[#434460]/40 rounded-lg mb-1.5">
                              <p className="text-[9px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest leading-none">
                                Actions Zakat
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-import-zakat'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#ffab00] dark:hover:text-[#ffab00] hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left"
                            >
                              <Upload size={14} strokeWidth={2.2} className="text-[#ffab00]" />
                              <span>Importer depuis Excel</span>
                            </button>

                            <button
                              onClick={() => {
                                setPurchaseGearOpen(false);
                                window.dispatchEvent(new CustomEvent('trigger-export-zakat'));
                              }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-50 dark:hover:bg-[#323249]/40 rounded-lg transition-colors cursor-pointer bg-transparent border-0 text-left mt-0.5"
                            >
                              <Download size={14} strokeWidth={2.2} className="text-emerald-500" />
                              <span>Exporter vers Excel (XLSX)</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  <NotificationBell />
                </div>
              </div>
            </div>
          </header>

          {/* 4. ACTUAL PAGE children WRAPPER */}
          <AnimatePresence>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-full w-full max-w-[1468px] mx-auto px-6 md:px-10"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* COMMAND PALETTE SEARCH OVERLAY (Dual Theme support) */}
      <AnimatePresence>
        {searchOpen && (
          <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh] px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
              className="absolute inset-0 bg-transparent dark:bg-transparent backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -10 }}
              transition={{ type: 'spring', duration: 0.22 }}
              className="relative w-full max-w-xl bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl overflow-hidden flex flex-col max-h-[50vh]"
            >
              <div className="p-4 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-[#a1acb8] dark:text-[#707194] flex-1">
                  <Search
                    size={18}
                    className="text-[#a1acb8] dark:text-[#707194] shrink-0"
                    strokeWidth={2.2}
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search [CTRL + K]"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent dark:bg-transparent focus:outline-none text-sm text-[#435971] dark:text-[#dbdade] placeholder-[#a1acb8] dark:placeholder-[#707194]"
                  />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-[#a1acb8] dark:text-[#707194] hidden sm:inline-block">
                    [esc]
                  </span>
                  <button
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery('');
                    }}
                    className="text-[#a1acb8] dark:text-[#707194] hover:text-[#435971] dark:hover:text-[#dbdade] transition-all cursor-pointer bg-transparent dark:bg-transparent flex items-center justify-center -mr-1"
                  >
                    <X size={15} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {searchQuery.trim() === '' ? (
                  <div className="pb-2 text-left">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 px-1">
                      {/* Left Column */}
                      <div>
                        <p className="text-[11px] font-semibold tracking-wider text-[#a1acb8] dark:text-[#707194] uppercase mb-3 block">
                          POPULAR SEARCHES
                        </p>
                        <div className="flex flex-col gap-1">
                          {[
                            { label: 'Tableau de bord', path: '/', icon: LayoutGrid },
                            { label: 'Clients', path: '/clients', icon: UserCircle },
                            { label: 'Dépenses', path: '/expenses', icon: Receipt },
                          ].map((item) => (
                            <button
                              key={item.label}
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(item.path);
                              }}
                              className="flex items-center bg-transparent dark:bg-transparent w-full group cursor-pointer text-[#566a7f] dark:text-[#dbdade] hover:text-[#696cff] dark:hover:text-[#b1b4ff] text-sm transition-colors text-left"
                            >
                              <item.icon className="text-[#566a7f] dark:text-[#a3a4cc] w-4 h-4 mr-3 shrink-0 group-hover:text-[#696cff] dark:group-hover:text-[#b1b4ff] transition-colors" />
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Right Column */}
                      <div>
                        <p className="text-[11px] font-semibold tracking-wider text-[#a1acb8] dark:text-[#707194] uppercase mb-3 block">
                          APPS & PAGES
                        </p>
                        <div className="flex flex-col gap-1">
                          {[
                            { label: 'Achats', path: '/purchases', icon: Package },
                            { label: 'Zakat', path: '/zakat', icon: Heart },
                            { label: 'Paramètres', path: '/settings', icon: Settings },
                          ].map((item) => (
                            <button
                              key={item.label}
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(item.path);
                              }}
                              className="flex items-center bg-transparent dark:bg-transparent w-full group cursor-pointer text-[#566a7f] dark:text-[#dbdade] hover:text-[#696cff] dark:hover:text-[#b1b4ff] text-sm transition-colors text-left"
                            >
                              <item.icon className="text-[#566a7f] dark:text-[#a3a4cc] w-4 h-4 mr-3 shrink-0 group-hover:text-[#696cff] dark:group-hover:text-[#b1b4ff] transition-colors" />
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-left px-1">
                    {searchResults.length === 0 ? (
                      <div className="py-8 text-center">
                        <Command className="w-8 h-8 mx-auto mb-2.5 opacity-20 text-[#a1acb8] dark:text-[#707194] animate-spin" />
                        <p className="text-[11px] font-semibold tracking-wider text-[#a1acb8] dark:text-[#707194] uppercase">
                          Aucun résultat trouvé dans Finexy
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold tracking-wider text-[#a1acb8] dark:text-[#707194] uppercase block">
                            RÉSULTATS DE RECHERCHE ({searchResults.length})
                          </p>
                        </div>
                        <div className="flex flex-col gap-1">
                          {searchResults.map((res, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setSearchOpen(false);
                                setSearchQuery('');
                                navigate(res.path);
                              }}
                              className="w-full flex items-center justify-between bg-transparent dark:bg-transparent text-left group cursor-pointer text-[#566a7f] dark:text-[#dbdade] hover:text-[#696cff] dark:hover:text-[#b1b4ff] text-sm transition-colors"
                            >
                              <div className="flex items-center min-w-0">
                                <ArrowRight className="text-[#566a7f] dark:text-[#a3a4cc] w-4 h-4 mr-3 shrink-0 group-hover:text-[#696cff] dark:group-hover:text-[#b1b4ff] transition-colors" />
                                <span className="truncate block">{res.name}</span>
                              </div>
                              <div className="text-[10px] uppercase tracking-wider text-[#a1acb8] dark:text-[#707194] shrink-0 font-medium">
                                {res.type}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="text-[11px] font-medium tracking-wide text-[#a1acb8] dark:text-[#707194] uppercase py-3 border-t border-[#dbdade]/70 dark:border-[#434460]/40 flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 justify-center bg-[#ffffff] dark:bg-[#2b2c40] rounded-b-xl">
                <span className="inline-flex items-center gap-1.5">
                  Cliquez sur{' '}
                  <strong className="font-semibold text-[#697a8d] dark:text-[#a3a4cc]">TAB</strong>{' '}
                  ou{' '}
                  <strong className="font-semibold text-[#697a8d] dark:text-[#a3a4cc]">
                    ENTRÉE
                  </strong>{' '}
                  pour valider
                </span>
                <span className="hidden sm:inline-block opacity-50">•</span>
                <span>version v{APP_VERSION}</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MOBILE DRAWER (Sneat Light Consistent Look) */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[1050] md:hidden font-sans">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="absolute inset-0 bg-[#0c0c10]/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              style={{ fontFamily: "'Public Sans', sans-serif" }}
              className="absolute left-0 top-0 bottom-0 w-[260px] bg-[#ffffff] dark:bg-[#2b2c40] flex flex-col z-[1051] border-r border-[#dbdade]/60 dark:border-[#434460]/40 h-full py-4 justify-between select-none"
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex flex-col">
                  {/* Brand Header */}
                  <div className="flex items-center justify-between pb-3 px-5 border-b border-slate-100 dark:border-[#434460]/30 mb-3 text-[#435971] dark:text-[#dbdade]">
                    <Link
                      to="/"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3"
                    >
                      <div className="w-[34px] h-[34px] rounded-lg bg-[#696cff] flex items-center justify-center shrink-0 shadow-[0_2px_6px_rgba(105,108,255,0.45)]">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 25 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="text-white"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M12.38 2.25c-.23 0-.46.03-.68.1L6.7 4.07c-1 .35-1.5 1.45-1.15 2.45L8.7 15.5c.35 1 1.45 1.5 2.45 1.15l5-1.72c1-.35 1.5-1.45 1.15-2.45l-3.15-8.98c-.35-1-1.45-1.5-2.45-1.15l-.32.11z"
                            fill="currentColor"
                            fillOpacity="0.4"
                          />
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M14.63 7.25c-.23 0-.46.03-.68.1l-5 1.72c-1 .35-1.5 1.45-1.15 2.45l3.15 8.98c.35 1 1.45 1.5 2.45 1.15l5-1.72c1-.35 1.5-1.45 1.15-2.45l-3.15-8.98c-.35-1-1.45-1.5-2.45-1.15l-.32.11z"
                            fill="currentColor"
                          />
                        </svg>
                      </div>
                      <div className="flex flex-col text-left">
                        <span
                          className="font-sans font-extrabold text-[21px] tracking-tight text-[#435971] dark:text-[#dbdade] leading-none mb-0.5"
                          style={{ letterSpacing: '-0.5px' }}
                        >
                          Finexy
                        </span>
                        <span
                          className="text-[10px] font-bold uppercase tracking-widest text-[#a1acb8] dark:text-[#707194] leading-none text-left"
                          style={{ letterSpacing: '1.2px' }}
                        >
                          Workspace
                        </span>
                      </div>
                    </Link>

                    <button
                      onClick={() => setMobileMenuOpen(false)}
                      className="w-8 h-8 rounded-md hover:bg-slate-50 dark:hover:bg-[#323249] text-slate-450 dark:text-[#a3a4cc] border border-slate-200 dark:border-[#434460]/40 flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <X size={15} strokeWidth={2.5} />
                    </button>
                  </div>

                  {/* Mobile Navigation List */}
                  <nav className="space-y-4 overflow-y-auto no-scrollbar max-h-[calc(100vh-160px)] py-2">
                    {menuSections.map((section) => (
                      <div key={section.title} className="space-y-1.5 flex flex-col text-left">
                        <p className="px-5 text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider pb-0.5 select-none">
                          {section.title}
                        </p>

                        <div className="space-y-0.5">
                          {section.items.map((item) => {
                            const isActive = isItemActive(item.path);
                            return (
                              <Link
                                key={item.label}
                                to={item.path}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`flex items-center justify-between h-[42px] px-4 mx-4 mb-1 rounded-[6px] transition-all relative ${
                                  isActive
                                    ? 'bg-[rgba(105,108,255,0.16)] dark:bg-[rgba(105,108,255,0.16)] text-[#696cff] dark:text-[#b1b4ff]'
                                    : 'text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#435971] dark:hover:text-[#dbdade] hover:bg-[#F5F5F9] dark:hover:bg-[#323249]/60'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={
                                      isActive
                                        ? 'text-[#696cff] dark:text-[#b1b4ff]'
                                        : 'text-[#697a8d] dark:text-[#a3a4cc]'
                                    }
                                  >
                                    <item.icon size={22} strokeWidth={isActive ? 1.7 : 1.5} />
                                  </div>
                                  <span
                                    className={`${isActive ? 'font-medium' : 'font-normal'} text-[15px] tracking-normal leading-none font-sans`}
                                  >
                                    {item.label}
                                  </span>
                                </div>

                                {item.tag && (
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${
                                      isActive
                                        ? 'bg-[#696cff] dark:bg-[#b1b4ff] text-white dark:text-[#232333] font-mono'
                                        : 'bg-[#F5F5F9] dark:bg-[#232333] text-[#a1acb8] dark:text-[#707194] font-mono'
                                    }`}
                                  >
                                    {item.tag}
                                  </span>
                                )}

                                {isActive && (
                                  <div className="absolute -right-4 top-0 bottom-0 w-1 bg-[#696cff] dark:bg-[#b1b4ff] rounded-l-[4px]" />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </nav>
                </div>

                {/* Mobile Account / Theme / Logout footer */}
                <div className="mt-auto pt-3.5 border-t border-slate-100 dark:border-[#434460]/30 shrink-0 flex flex-col gap-1.5 px-3">
                  {/* Theme Switcher & User Profile */}
                  <div className="px-[15px] flex items-center justify-between h-[42px]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {user?.photoURL ? (
                        <img
                          src={user.photoURL}
                          className="w-7 h-7 rounded-full object-cover border border-[#dbdade]/60 dark:border-[#434460]/40"
                          alt="Compte"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-7 h-7 bg-slate-100 dark:bg-[#323249] text-[#696cff] dark:text-[#b1b4ff] rounded-full flex items-center justify-center font-extrabold text-[10px] uppercase">
                          {getInitials(user?.displayName || user?.email)}
                        </div>
                      )}
                      <span className="text-xs font-bold text-[#435971] dark:text-[#dbdade] truncate">
                        {user?.displayName || user?.email?.split('@')[0]}
                      </span>
                    </div>
                    <button
                      onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#323249]/60 text-[#697a8d] dark:text-[#a3a4cc] transition-colors focus:outline-hidden cursor-pointer"
                      title={theme === 'dark' ? 'Mode Clair' : 'Mode Sombre'}
                    >
                      {theme === 'dark' ? (
                        <Sun size={17} strokeWidth={1.8} />
                      ) : (
                        <Moon size={17} strokeWidth={1.8} />
                      )}
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleLogout();
                    }}
                    className="w-full h-[42px] px-[15px] bg-transparent hover:bg-[#ffebe6] dark:hover:bg-[rgba(255,62,29,0.12)] rounded-[6px] flex items-center justify-start gap-3 transition-colors text-[#ff3e1d] font-semibold text-[14px] cursor-pointer border-0 outline-none"
                  >
                    <LogOut size={19} strokeWidth={2.2} className="text-[#ff3e1d]" />
                    <span>Se déconnecter</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
