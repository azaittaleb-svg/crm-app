import { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { calculatePurchaseBalance } from "../utils/balanceUtils";
import { deduplicateExpenses } from "../utils/expenseUtils";
import { CustomerService } from '../services/customer.service';
import {
  calculateWooCommerceProfitStats,
  getStoredWooOrders,
  saveStoredWooOrders,
} from '../utils/wooProfit';
import {
  expenseService,
  MonthlyExpense,
  ExpenseStatus,
  ExpenseTemplate,
} from '../services/expenseService';

export function useDashboardData() {
  const { user } = useAuth();
  const { showToast } = useNotification();

  const [clientsCount, setClientsCount] = useState(0);
  const [suppliersCount, setSuppliersCount] = useState(0);
  const [clientsMap, setClientsMap] = useState<Record<string, string>>({});
  const [purchases, setPurchases] = useState<any[]>([]);
  const [supplierPurchases, setSupplierPurchases] = useState<any[]>([]);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [returnsNotes, setReturnsNotes] = useState<any[]>([]);
  const [allExpenses, setAllExpenses] = useState<MonthlyExpense[]>([]);
  const [templates, setTemplates] = useState<ExpenseTemplate[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [supplierPeriod, setSupplierPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [returnsPeriod, setReturnsPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [productSales] = useState<any[]>([]);

  // WooCommerce Profit tracking with persistent cache
  const [wooOrders, setWooOrders] = useState<any[]>(() => getStoredWooOrders());
  const [isWooLoading, setIsWooLoading] = useState<boolean>(false);

  const fetchWooOrders = (forceRefresh = false) => {
    if (!user) return;
    setIsWooLoading(true);
    const url = forceRefresh ? '/api/woocommerce/orders?refresh=true' : '/api/woocommerce/orders';
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('WooCommerce API error');
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setWooOrders(data);
          saveStoredWooOrders(data);
        }
      })
      .catch((err) => console.warn('HomePage: Error loading WooCommerce orders for profit stats:', err))
      .finally(() => setIsWooLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchWooOrders();

    // Set up hourly auto-refresh timer (60 minutes)
    const intervalId = setInterval(() => {
      fetchWooOrders();
    }, 60 * 60 * 1000);

    // Refetch when window regains focus
    const handleFocus = () => {
      fetchWooOrders();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user]);

  const wooProfitStats = useMemo(() => {
    return calculateWooCommerceProfitStats(wooOrders);
  }, [wooOrders]);

  useEffect(() => {
    if (!user) return;
    expenseService
      .getTemplates()
      .then(setTemplates)
      .catch((err) => console.error('Error loading templates fallback on HomePage:', err));
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let clientsLoaded = false;
    let purchasesLoaded = false;
    let expensesLoaded = false;

    const checkLoading = () => {
      if (clientsLoaded && purchasesLoaded && expensesLoaded) {
        setIsLoadingData(false);
      }
    };

    // 1. Sync Monthly Expenses
    expenseService.syncMonthlyExpenses().catch((err) => {
      console.error('HomePage: Error during expense sync:', err);
    });

    const unsubscribeExpenses = onSnapshot(
      query(collection(db, 'expenses'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        let data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as MonthlyExpense[];

        // Filter out any Zakat and soft-deleted expenses
        data = data.filter(
          (e) => !(e.name || '').toLowerCase().includes('zakat') && !(e as any).deleted
        );

        // Deduplicate the same way as ExpensesPage to keep UI perfectly matches and clean DB
        const toDelete: string[] = [];
        data = deduplicateExpenses(data, toDelete) as MonthlyExpense[];

        if (toDelete.length > 0) {
          setTimeout(async () => {
            try {
              const { deleteDoc, doc } = await import('firebase/firestore');
              for (const id of toDelete) {
                await deleteDoc(doc(db, 'expenses', id));
              }
            } catch (e) {}
          }, 2000);
        }

        setAllExpenses(data.sort((a, b) => String(b.monthYear || '').localeCompare(String(a.monthYear || ''))));
        expensesLoaded = true;
        checkLoading();
      },
      (error) => {
        console.error('HomePage: Expenses snapshot error:', error);
        expensesLoaded = true;
        checkLoading();
        handleFirestoreError(error, OperationType.LIST, 'expenses');
      }
    );

    const unsubscribeClients = onSnapshot(
      query(collection(db, 'clients'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        setClientsCount(snapshot.size);
        const docsList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setClients(docsList);
        const newMap: Record<string, string> = {};
        snapshot.forEach((doc) => {
          newMap[doc.id] = doc.data().name || 'Client Inconnu';
        });
        setClientsMap(newMap);
        clientsLoaded = true;
        checkLoading();
      },
      (error) => {
        console.error('HomePage: Clients snapshot error:', error);
        clientsLoaded = true;
        checkLoading();
        handleFirestoreError(error, OperationType.LIST, 'clients');
      }
    );

    const unsubscribeSuppliers = onSnapshot(
      query(collection(db, 'suppliers'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        setSuppliersCount(snapshot.size);
        const docsList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setSuppliers(docsList);
      }
    );

    const unsubscribePurchases = onSnapshot(
      query(collectionGroup(db, 'purchases'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const parentDoc = docSnap.ref.parent?.parent;
          const parentCollection = parentDoc?.parent?.id; // "clients" or "suppliers"
          const parentId = parentDoc?.id;
          return {
            id: docSnap.id,
            ...docSnap.data(),
            parentId,
            parentPath: parentCollection,
          } as any;
        });

        const clientPurchases = data
          .filter((p) => p.parentPath === 'clients' || (!p.parentPath && (p.clientId || p.parentId)))
          .map((p) => ({ ...p, clientId: p.clientId || p.parentId }));

        const supplierPurchasesData = data
          .filter((p) => p.parentPath === 'suppliers')
          .map((p) => ({ ...p, supplierId: p.supplierId || p.parentId }));

        const sortedClients = clientPurchases.sort(
          (a, b) =>
            (b.date?.toMillis ? b.date.toMillis() : 0) - (a.date?.toMillis ? a.date.toMillis() : 0)
        );

        setPurchases(sortedClients);
        setSupplierPurchases(supplierPurchasesData);

        purchasesLoaded = true;
        checkLoading();
      },
      (error) => {
        console.error('HomePage: Purchases snapshot error:', error);
        purchasesLoaded = true;
        checkLoading();
        handleFirestoreError(error, OperationType.LIST, 'purchases_group');
      }
    );

    const unsubscribeCreditNotes = onSnapshot(
      query(collectionGroup(db, 'credit_notes'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const notes = snapshot.docs.map((docSnap) => {
          const parentDoc = docSnap.ref.parent?.parent;
          return {
            id: docSnap.id,
            ...docSnap.data(),
            clientId: (docSnap.data() as any).clientId || parentDoc?.id,
          } as any;
        });
        setCreditNotes(notes);
      },
      (error) => {
        console.error('HomePage: Credit notes error:', error);
      }
    );

    const unsubscribeReturns = onSnapshot(
      query(collection(db, 'returns_notes'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setReturnsNotes(data);
      },
      (error) => {
        console.error('HomePage: Returns snapshot error:', error);
      }
    );

    // Fail-safe timeout to unblock UI after 10 seconds
    const timeoutId = setTimeout(() => {
      setIsLoadingData(false);
    }, 10000);

    return () => {
      unsubscribeExpenses();
      unsubscribeClients();
      unsubscribeSuppliers();
      unsubscribePurchases();
      unsubscribeCreditNotes();
      unsubscribeReturns();
      clearTimeout(timeoutId);
    };
  }, [user]);

  const currentMonthExpenses = useMemo(() => {
    const currentMonthYear = new Date().toISOString().slice(0, 7);
    return allExpenses.filter((e) => e.monthYear === currentMonthYear);
  }, [allExpenses]);

  const visibleCurrentMonthExpenses = useMemo(() => {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthStr = today.toISOString().slice(0, 7);

    return currentMonthExpenses.filter(expense => {
      if (expense.status === ExpenseStatus.PAID) return true;
      
      if (expense.monthYear === currentMonthStr) {
        const isRecurring = expense.templateId && expense.templateId !== 'instant';
        if (isRecurring && expense.dueDay) {
          if (currentDay < expense.dueDay - 1) {
            return false;
          }
        }
      }
      return true;
    });
  }, [currentMonthExpenses]);

  const currentMonthPaidExpenses = useMemo(() => {
    return visibleCurrentMonthExpenses
      .filter((e) => e.status === ExpenseStatus.PAID)
      .reduce((acc, curr) => acc + (curr.amount || 0), 0);
  }, [visibleCurrentMonthExpenses]);

  const currentMonthPendingExpenses = useMemo(() => {
    return visibleCurrentMonthExpenses
      .filter((e) => e.status === ExpenseStatus.PENDING)
      .reduce((acc, curr) => acc + (curr.amount || 0), 0);
  }, [visibleCurrentMonthExpenses]);

  const validPurchases = useMemo(
    () =>
      purchases.filter(
        (p) => p.type !== 'devis' && p.status !== 'Annulée' && p.status !== 'Brouillon'
      ),
    [purchases]
  );

  const validSupplierPurchases = useMemo(
    () =>
      supplierPurchases.filter(
        (p) => p.type !== 'devis' && p.status !== 'Annulée' && p.status !== 'Brouillon'
      ),
    [supplierPurchases]
  );

  const globalClientStats = useMemo(() => {
    return CustomerService.calculateCustomerStats(validPurchases, creditNotes);
  }, [validPurchases, creditNotes]);

  const totalAmount = globalClientStats.totalSales;
  const totalPaid = globalClientStats.totalPaid;
  const totalCredit = globalClientStats.detteClient;
  const totalCreditDispo = globalClientStats.creditClient;

  const totalSupplierCredit = useMemo(
    () =>
      validSupplierPurchases.reduce((acc, curr) => {
        const { debt } = calculatePurchaseBalance(curr);
        return acc + debt;
      }, 0),
    [validSupplierPurchases]
  );

  const totalExpenses = useMemo(
    () => visibleCurrentMonthExpenses.reduce((acc, curr) => acc + (curr.amount || 0), 0),
    [visibleCurrentMonthExpenses]
  );

  const pendingExpensesCount = useMemo(
    () => visibleCurrentMonthExpenses.filter((e) => e.status === ExpenseStatus.PENDING).length,
    [visibleCurrentMonthExpenses]
  );

  const recoveryRate = useMemo(() => {
    return totalAmount > 0 ? Math.min(100, (totalPaid / totalAmount) * 100) : 0;
  }, [totalPaid, totalAmount]);

  const estimatedLiquidCash = useMemo(() => {
    return totalPaid - currentMonthPaidExpenses;
  }, [totalPaid, currentMonthPaidExpenses]);

  const totalSupplierPurchasesAmount = useMemo(() => {
    return validSupplierPurchases.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0);
  }, [validSupplierPurchases]);

  const returnsCount = useMemo(() => returnsNotes.length, [returnsNotes]);

  const totalReturnsAmount = useMemo(() => {
    return returnsNotes.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }, [returnsNotes]);

  const supplierPurchaseSparklineData = useMemo(() => {
    if (supplierPeriod === 'day') {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d;
      }).reverse();

      return days.map((d) => {
        const labelStr = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
        const key = d.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
        });

        let sum = 0;
        validSupplierPurchases.forEach((p) => {
          const pDate = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
          if (pDate) {
            const pKey = pDate.toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'numeric',
              year: 'numeric',
            });
            if (pKey === key) {
              sum += Number(p.total) || 0;
            }
          }
        });

        return {
          label: labelStr.charAt(0).toUpperCase() + labelStr.slice(1),
          value: sum,
          shortName: d.toLocaleDateString('fr-FR', { weekday: 'narrow' }).toUpperCase(),
        };
      });
    } else if (supplierPeriod === 'week') {
      return Array.from({ length: 4 }, (_, i) => {
        const start = new Date();
        start.setDate(start.getDate() - (i + 1) * 7);
        const end = new Date();
        end.setDate(end.getDate() - i * 7);

        let sum = 0;
        validSupplierPurchases.forEach((p) => {
          const pDate = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
          if (pDate && pDate >= start && pDate <= end) {
            sum += Number(p.total) || 0;
          }
        });

        return {
          label: `Semaine ${4 - i}`,
          value: sum,
          shortName: `S${4 - i}`,
        };
      }).reverse();
    } else {
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return d;
      }).reverse();

      return months.map((d) => {
        const monthIndex = d.getMonth();
        const yearValue = d.getFullYear();
        const shortName = d.toLocaleDateString('fr-FR', { month: 'short' });

        let sum = 0;
        validSupplierPurchases.forEach((p) => {
          const pDate = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
          if (pDate && pDate.getMonth() === monthIndex && pDate.getFullYear() === yearValue) {
            sum += Number(p.total) || 0;
          }
        });

        return {
          label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          value: sum,
          shortName: shortName.charAt(0).toUpperCase() + shortName.slice(1, 3),
        };
      });
    }
  }, [supplierPurchases, supplierPeriod, validSupplierPurchases]);

  const returnsSparklineData = useMemo(() => {
    if (returnsPeriod === 'day') {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d;
      }).reverse();

      return days.map((d) => {
        const labelStr = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
        const key = d.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
        });

        let sum = 0;
        returnsNotes.forEach((r) => {
          const rDate = r.date?.toDate ? r.date.toDate() : r.date ? new Date(r.date) : null;
          if (rDate) {
            const rKey = rDate.toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'numeric',
              year: 'numeric',
            });
            if (rKey === key) {
              sum += Number(r.amount) || 0;
            }
          }
        });

        return {
          label: labelStr.charAt(0).toUpperCase() + labelStr.slice(1),
          value: sum,
          shortName: d.toLocaleDateString('fr-FR', { weekday: 'narrow' }).toUpperCase(),
        };
      });
    } else if (returnsPeriod === 'week') {
      return Array.from({ length: 4 }, (_, i) => {
        const start = new Date();
        start.setDate(start.getDate() - (i + 1) * 7);
        const end = new Date();
        end.setDate(end.getDate() - i * 7);

        let sum = 0;
        returnsNotes.forEach((r) => {
          const rDate = r.date?.toDate ? r.date.toDate() : r.date ? new Date(r.date) : null;
          if (rDate && rDate >= start && rDate <= end) {
            sum += Number(r.amount) || 0;
          }
        });

        return {
          label: `Semaine ${4 - i}`,
          value: sum,
          shortName: `S${4 - i}`,
        };
      }).reverse();
    } else {
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return d;
      }).reverse();

      return months.map((d) => {
        const monthIndex = d.getMonth();
        const yearValue = d.getFullYear();
        const shortName = d.toLocaleDateString('fr-FR', { month: 'short' });

        let sum = 0;
        returnsNotes.forEach((r) => {
          const rDate = r.date?.toDate ? r.date.toDate() : r.date ? new Date(r.date) : null;
          if (rDate && rDate.getMonth() === monthIndex && rDate.getFullYear() === yearValue) {
            sum += Number(r.amount) || 0;
          }
        });

        return {
          label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          value: sum,
          shortName: shortName.charAt(0).toUpperCase() + shortName.slice(1, 3),
        };
      });
    }
  }, [returnsNotes, returnsPeriod]);

  const zakatTemplates = useMemo(() => {
    return templates.filter((t) => {
      const nameLower = (t.name || '').toLowerCase();
      const catLower = (t.category || '').toLowerCase();
      return nameLower.includes('zakat') || catLower.includes('zakat');
    });
  }, [templates]);

  const totalZakatAllocated = useMemo(() => {
    return zakatTemplates.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [zakatTemplates]);

  const expenseRatio = useMemo(() => {
    return totalAmount > 0 ? Math.min(100, Math.round((totalExpenses / totalAmount) * 100)) : 0;
  }, [totalExpenses, totalAmount]);

  const balanceStats = useMemo(() => {
    const walletText = `${estimatedLiquidCash.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    const zakatText = `${totalZakatAllocated.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

    const balanceFlow = [
      { name: 'Jan', balance: Number((totalPaid * 0.15).toFixed(0)) },
      { name: 'Feb', balance: Number((totalPaid * 0.3).toFixed(0)) },
      { name: 'Mar', balance: Number((totalPaid * 0.45).toFixed(0)) },
      { name: 'Apr', balance: Number((totalPaid * 0.6).toFixed(0)) },
      { name: 'May', balance: Number((totalPaid * 0.8).toFixed(0)) },
      { name: 'Jun', balance: Number(totalPaid.toFixed(0)) },
    ];

    return {
      walletAmount: walletText,
      paypalAmount: zakatText,
      growthPercentage: recoveryRate > 0 ? `${recoveryRate.toFixed(1)}%` : '100%',
      chartData: balanceFlow,
    };
  }, [estimatedLiquidCash, totalZakatAllocated, totalPaid, recoveryRate]);

  const handleValidateExpense = async (id: string, amount: number) => {
    try {
      await expenseService.validateExpense(id, amount);
      showToast('Charge enregistrée et encaissée !');
    } catch (err) {
      showToast("Erreur d'encaissement de la charge", 'error');
    }
  };

  const chartData = useMemo(() => {
    const dailyData: { [key: string]: number } = {};
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }).reverse();

    validPurchases.forEach((p) => {
      if (!p.date) return;
      const dateKey = p.date
        .toDate()
        .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const total = Number(p.total) || 0;
      const amountPaid = p.amountPaid !== undefined ? Number(p.amountPaid) : total;
      const credit = total - amountPaid;

      const isCreditNote = p.refId?.startsWith('RINV/');
      const factor = isCreditNote ? -1 : 1;
      dailyData[dateKey] = (dailyData[dateKey] || 0) + credit * factor;
    });

    return last7Days.map((date) => ({
      name: date,
      value: dailyData[date] || 0,
    }));
  }, [validPurchases]);

  const expenseChartData = useMemo(() => {
    const monthlyData: { [key: string]: number } = {};
    const last6Months: string[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      last6Months.push(d.toISOString().slice(0, 7));
    }

    allExpenses.forEach((e) => {
      if (e.monthYear) {
        monthlyData[e.monthYear] = (monthlyData[e.monthYear] || 0) + e.amount;
      }
    });

    return last6Months.map((month) => {
      const monthStr = typeof month === 'string' ? month : String(month || '');
      const parts = monthStr.includes('-') ? monthStr.split('-') : [];
      let shortMonth = monthStr;
      if (parts.length === 2) {
        const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
        if (!isNaN(dateObj.getTime())) {
          shortMonth = dateObj.toLocaleDateString('fr-FR', { month: 'short' });
        }
      }
      return {
        name: shortMonth,
        value: monthlyData[monthStr] || 0,
      };
    });
  }, [allExpenses]);

  const multiMonthStats = useMemo(() => {
    const months = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const isCurrentMonth = i === 0;
      const isPrevMonth = i === 1;
      return {
        date: d,
        name: d.toLocaleDateString('en-US', { month: 'short' }),
        monthKey: d.toLocaleDateString('fr-FR', { month: 'numeric', year: 'numeric' }),
        monthYear: d.toISOString().slice(0, 7),
        isCurrentMonth,
        isPrevMonth,
        income: 0,
        earnings: 0,
        expenses: 0,
        salesCount: 0,
      };
    }).reverse();

    validPurchases.forEach((p) => {
      const pDate = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
      if (pDate) {
        const pKey = pDate.toLocaleDateString('fr-FR', { month: 'numeric', year: 'numeric' });
        const m = months.find((m) => m.monthKey === pKey);
        if (m) {
          const total = Number(p.total) || 0;
          const isPaid =
            p.paymentStatus === 'paid' ||
            p.status === 'Payée' ||
            Number(p.total) - (Number(p.amountPaid) || 0) <= 0.05;
          const paid = p.amountPaid !== undefined ? Number(p.amountPaid) : isPaid ? total : 0;

          const isCreditNote = p.refId?.startsWith('RINV/');
          if (isCreditNote) {
            m.income -= paid;
            m.earnings -= total;
          } else {
            m.income += paid;
            m.earnings += total;
          }
          m.salesCount += 1;
        }
      }
    });

    // Add WooCommerce profits directly to monthly income/earnings
    if (wooOrders && wooOrders.length > 0) {
      wooOrders.forEach((order) => {
        if (order.status === 'completed') {
          const orderDate = new Date(order.date_created || order.date_created_gmt);
          const pKey = orderDate.toLocaleDateString('fr-FR', { month: 'numeric', year: 'numeric' });
          const m = months.find((m) => m.monthKey === pKey);
          if (m) {
            const total = parseFloat(order.total) || 0;
            // Assuming average margin for woo orders is what's used in profit, let's just add the profit
            // Wait, the user wants to compare expenses with woo profit specifically? 
            // "adir liha entre depence dialna dial chaque moi m3a l benifice li 3endna li kayn f la page woo"
            // Let's add Woo Profit to the income of the month so it gets compared against expenses.
            // Profit is calculated by subtracting VitPOS purchase price from order total.
            let profit = 0;
            order.line_items?.forEach((item: any) => {
              const itemTotal = parseFloat(item.total) || 0;
              const originalCost = parseFloat(item.meta_data?.find((m: any) => m.key === '_vitpos_purchase_price')?.value || '0');
              const itemProfit = itemTotal - (originalCost > 0 ? originalCost * item.quantity : 0);
              profit += itemProfit;
            });

            // We add the WooCommerce profit to the income
            m.income += profit;
            m.earnings += profit; 
          }
        }
      });
    }

    allExpenses.forEach((e) => {
      if (e.monthYear) {
        const m = months.find((m) => m.monthYear === e.monthYear);
        if (m) {
          m.expenses += Number(e.amount) || 0;
        }
      }
    });

    const currM = months.find((m) => m.isCurrentMonth);
    const prevM = months.find((m) => m.isPrevMonth);

    const calcTrend = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? '+100%' : '0%';
      const diff = ((curr - prev) / prev) * 100;
      return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
    };

    const salesTrend = currM && prevM ? calcTrend(currM.income, prevM.income) : '0%';
    const txTrend = currM && prevM ? calcTrend(currM.salesCount, prevM.salesCount) : '0%';

    const currProfit = (currM?.income || 0) - (currM?.expenses || 0);
    const prevProfit = (prevM?.income || 0) - (prevM?.expenses || 0);
    const profitDiff = currProfit - prevProfit;
    const profitDiffFormatted =
      profitDiff > 0
        ? `+${profitDiff.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : profitDiff.toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

    const incomeDiff = (currM?.income || 0) - (prevM?.income || 0);
    const incomeDiffFormatted =
      incomeDiff > 0
        ? `+${incomeDiff.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : incomeDiff.toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

    const expensesDiff = (currM?.expenses || 0) - (prevM?.expenses || 0);
    const expensesDiffFormatted =
      expensesDiff > 0
        ? `${expensesDiff.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : expensesDiff.toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

    const radarData = months.slice(1).map((m) => ({
      subject: m.name,
      Income: Number(m.income.toFixed(2)),
      Earning: Number(m.earnings.toFixed(2)),
    }));

    const incomeChartData = months.map((m) => ({
      name: m.name,
      income: Number(m.income.toFixed(2)),
      expenses: Number(m.expenses.toFixed(2)),
      profit: Number((m.income - m.expenses).toFixed(2)),
    }));

    const profitMonths = months.slice(3, 7);
    const maxProfit = Math.max(...profitMonths.map((m) => Math.max(m.income - m.expenses, 1)));
    const profitChartData = profitMonths.map((m) => {
      const p = m.income - m.expenses;
      return {
        label: m.name,
        height: `${Math.max((p / maxProfit) * 100, 5)}%`,
        profit: p,
      };
    });

    const maxCombined = Math.max(...months.map((m) => Math.max(m.income + m.expenses, 1)));
    const expensesSplitChartData = months.map((m) => {
      return {
        upper: (m.income / maxCombined) * 100,
        lower: (m.expenses / maxCombined) * 100,
        label: m.name,
      };
    });

    return {
      salesTrend,
      txTrend,
      profitDiffFormatted,
      incomeDiffFormatted,
      expensesDiffFormatted,
      radarData,
      incomeChartData,
      currentIncome: currM?.income || 0,
      currentExpenses: currM?.expenses || 0,
      currentProfit: currProfit,
      currentEarnings: currM?.earnings || 0,
      currentSalesCount: currM?.salesCount || 0,
      profitChartData,
      expensesSplitChartData,
      months,
    };
  }, [validPurchases, allExpenses, wooOrders]);

  const recentPurchases = useMemo(() => purchases.slice(0, 3), [purchases]);

  const creditNotesStats = useMemo(() => {
    let totalAvoirs = 0;
    let totalUtilises = 0;
    let totalDisponibles = 0;
    
    const validCreditNotes = creditNotes.filter(cn => cn.status === 'Validé' || cn.status === 'Utilisé');
    
    validCreditNotes.forEach(cn => {
      totalAvoirs += cn.total || 0;
      totalUtilises += cn.amountUsed || 0;
    });
    
    totalDisponibles = totalAvoirs - totalUtilises;
    
    return {
      count: validCreditNotes.length,
      totalAvoirs,
      totalUtilises,
      totalDisponibles
    };
  }, [creditNotes]);

  const recentCreditNotes = useMemo(() => {
    return [...creditNotes]
      .filter(cn => cn.status !== 'Brouillon')
      .sort((a, b) => (b.date?.toMillis ? b.date.toMillis() : 0) - (a.date?.toMillis ? a.date.toMillis() : 0))
      .slice(0, 3);
  }, [creditNotes]);

  return {
    clientsCount,
    suppliersCount,
    clientsMap,
    purchases,
    supplierPurchases,
    creditNotes,
    returnsNotes,
    allExpenses,
    templates,
    clients,
    suppliers,
    isLoadingData,
    currentMonthExpenses,
    visibleCurrentMonthExpenses,
    currentMonthPaidExpenses,
    currentMonthPendingExpenses,
    validPurchases,
    validSupplierPurchases,
    globalClientStats,
    totalAmount,
    totalPaid,
    totalCredit,
    totalCreditDispo,
    totalSupplierCredit,
    totalExpenses,
    pendingExpensesCount,
    recoveryRate,
    estimatedLiquidCash,
    totalSupplierPurchasesAmount,
    returnsCount,
    totalReturnsAmount,
    supplierPurchaseSparklineData,
    returnsSparklineData,
    zakatTemplates,
    totalZakatAllocated,
    expenseRatio,
    balanceStats,
    chartData,
    expenseChartData,
    multiMonthStats,
    recentPurchases,
    creditNotesStats,
    recentCreditNotes,
    productSales,
    supplierPeriod,
    setSupplierPeriod,
    returnsPeriod,
    setReturnsPeriod,
    handleValidateExpense,
    wooOrders,
    isWooLoading,
    wooProfitStats,
  };
}
