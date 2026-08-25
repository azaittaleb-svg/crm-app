import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  Heart,
  Check,
  AlertTriangle,
  Sparkles,
  Moon,
  ArrowRight,
  Copy,
  X,
  Calendar,
  ShoppingCart,
  Clock,
} from 'lucide-react';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  getIslamicDate,
  isZakatReminderActive,
  dismissZakatReminderForYear,
  detectZakatSimulation,
} from '../utils/hijriHelper';
import { getUpcomingHolidays, Holiday } from '../utils/moroccoHolidays';
import {
  getStoredWooOrders,
  getReminderSentInfo,
  getManualVirementConfirmations,
  setStoredRemindersSent,
  getDaysSinceOrder,
  isOrderOverdue,
} from '../utils/wooProfit';

export function NotificationBell() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [hijriDate, setHijriDate] = useState(getIslamicDate());
  const [reminderActive, setReminderActive] = useState<boolean>(isZakatReminderActive());
  const [isSimulated, setIsSimulated] = useState<boolean>(
    () => localStorage.getItem('simulate_hijri_zakat_reminder') === 'true'
  );
  const [isSimDismissed, setIsSimDismissed] = useState<boolean>(
    () => localStorage.getItem(`zakat_sim_dismissed_year_${getIslamicDate().year}`) === 'true'
  );
  const [zakatTemplates, setZakatTemplates] = useState<any[]>([]);
  const [pendingExpenses, setPendingExpenses] = useState<any[]>([]);
  const [isSimExpensesMode, setIsSimExpensesMode] = useState<boolean>(
    () => localStorage.getItem('simulate_pending_expenses') === 'true'
  );
  const [isSimHolidayMode, setIsSimHolidayMode] = useState<boolean>(
    () => localStorage.getItem('simulate_holiday') === 'true'
  );
  const [isExpensesNotifDismissed, setIsExpensesNotifDismissed] = useState<boolean>(
    () => sessionStorage.getItem('expenses_notif_dismissed') === 'true'
  );
  const [isOverdueNotifDismissed, setIsOverdueNotifDismissed] = useState<boolean>(
    () => sessionStorage.getItem('woo_overdue_notif_dismissed') === 'true'
  );
  const [holidays, setHolidays] = useState<Holiday[]>(getUpcomingHolidays());
  const [dismissedHolidays, setDismissedHolidays] = useState<string[]>(() =>
    JSON.parse(sessionStorage.getItem('dismissed_holidays') || '[]')
  );

  useEffect(() => {
    let unsubSnap: (() => void) | null = null;
    let unsubExpenses: (() => void) | null = null;

    const unsubAuth = auth.onAuthStateChanged((user) => {
      // Clean up previous listeners if any
      if (unsubSnap) {
        unsubSnap();
        unsubSnap = null;
      }
      if (unsubExpenses) {
        unsubExpenses();
        unsubExpenses = null;
      }

      if (!user) {
        setZakatTemplates([]);
        setPendingExpenses([]);
        return;
      }

      const templatesQuery = query(
        collection(db, 'expense_templates'),
        where('ownerId', '==', user.uid)
      );

      unsubSnap = onSnapshot(
        templatesQuery,
        (snapshot) => {
          const allTemplates = snapshot.docs.map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              name: d.name || d.titre,
              amount: d.amount !== undefined ? d.amount : d.montant,
              category: d.category || d.categorie,
            };
          });

          const filtered = allTemplates.filter((t) => {
            const nameLower = (t.name || '').toLowerCase();
            const catLower = (t.category || '').toLowerCase();
            return nameLower.includes('zakat') || catLower.includes('zakat');
          });

          setZakatTemplates(filtered);
        },
        (err) => {
          console.error('Error fetching zakat templates for notification:', err);
        }
      );

      const currentMonthYear = new Date().toISOString().slice(0, 7);
      const expensesQuery = query(
        collection(db, 'expenses'),
        where('ownerId', '==', user.uid),
        where('monthYear', '==', currentMonthYear)
      );

      unsubExpenses = onSnapshot(
        expensesQuery,
        (snapshot) => {
          const today = new Date().getDate();
          let pExpenses = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }) as any)
            .filter((doc) => doc.status === 'PENDING');

          // Include all pending expenses of this month
          pExpenses = pExpenses.filter(
            (e: any) => !(e.name || '').toLowerCase().includes('zakat') && !e.deleted
          );

          // Deduplicate
          const seenNames = new Map<string, any>();
          for (const exp of pExpenses) {
            const isRecurring = exp.templateId && exp.templateId !== 'instant';
            const strName = (exp.name || '').trim().toLowerCase();

            const exactMatchKey = `exact_${strName}_${exp.amount}_${exp.status}`;
            const templateKey = isRecurring ? `tpl_${exp.templateId}` : null;

            if (seenNames.has(exactMatchKey)) {
              const existing = seenNames.get(exactMatchKey)!;
              if (existing.templateId === 'instant' && isRecurring) {
                seenNames.set(exactMatchKey, exp);
                if (templateKey) seenNames.set(templateKey, exp);
              }
            } else if (templateKey && seenNames.has(templateKey)) {
              // duplicate from same template, do nothing and drop
            } else {
              seenNames.set(exactMatchKey, exp);
              if (templateKey) seenNames.set(templateKey, exp);
            }
          }

          pExpenses = Array.from(new Set(seenNames.values()));

          setPendingExpenses(pExpenses);
        },
        (err) => {
          console.error('Error fetching pending expenses for notification:', err);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubSnap) unsubSnap();
      if (unsubExpenses) unsubExpenses();
    };
  }, []);

  const [pendingWooCount, setPendingWooCount] = useState<number>(0);
  const [overdueWooOrders, setOverdueWooOrders] = useState<any[]>([]);

  const checkWooNotifications = () => {
    try {
      const wooOrders = getStoredWooOrders();
      if (!Array.isArray(wooOrders) || wooOrders.length === 0) {
        setPendingWooCount(0);
        setOverdueWooOrders([]);
        return;
      }
      const confirmations = getManualVirementConfirmations();
      const pending = wooOrders.filter((o: any) => {
        if (!o || !o.id) return false;
        const statusLower = (o.status || '').toLowerCase();
        if (['completed', 'cancelled', 'refunded', 'failed', 'trash'].includes(statusLower)) return false;
        let feeAvance = 0;
        if (Array.isArray(o.fee_lines)) {
          for (const fee of o.fee_lines) {
            const feeName = (fee.name || '').toLowerCase();
            const feeTotal = parseFloat(fee.total || '0');
            if (feeName.includes('avance') || feeName.includes('acompte') || feeName.includes('décompte') || feeName.includes('decompte')) {
              feeAvance += Math.abs(feeTotal);
            }
          }
        }
        if (feeAvance <= 0) return false;
        const rem = getReminderSentInfo(o.id);
        const conf = confirmations[String(o.id)];
        return !rem && !conf?.isConfirmed;
      });
      setPendingWooCount(pending.length);

      // Overdue orders (+2 days non terminal)
      const overdue = wooOrders
        .filter((o: any) => isOrderOverdue(o, 2))
        .sort((a: any, b: any) => {
          const daysA = getDaysSinceOrder(a.date_created).days;
          const daysB = getDaysSinceOrder(b.date_created).days;
          return daysB - daysA;
        });
      setOverdueWooOrders(overdue);
    } catch (e) {
      console.warn('Error checking pending WooCommerce orders for notifications:', e);
    }
  };

  useEffect(() => {
    const handleUpdate = () => {
      setHijriDate(getIslamicDate());
      setReminderActive(isZakatReminderActive());
      setIsSimulated(localStorage.getItem('simulate_hijri_zakat_reminder') === 'true');
      setIsSimDismissed(
        localStorage.getItem(`zakat_sim_dismissed_year_${getIslamicDate().year}`) === 'true'
      );
      setIsSimExpensesMode(localStorage.getItem('simulate_pending_expenses') === 'true');
      setIsSimHolidayMode(localStorage.getItem('simulate_holiday') === 'true');
      setHolidays(getUpcomingHolidays());
      checkWooNotifications();
    };

    handleUpdate();
    window.addEventListener('zakatSimulationChange', handleUpdate);
    const t = setInterval(handleUpdate, 5000);

    const unsubWooReminders = onSnapshot(
      doc(db, 'settings', 'woo_reminders'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data && data.remindersMap) {
            setStoredRemindersSent(data.remindersMap);
            checkWooNotifications();
          }
        }
      },
      (err) => {
        console.warn('Error listening to settings/woo_reminders:', err);
      }
    );

    return () => {
      window.removeEventListener('zakatSimulationChange', handleUpdate);
      clearInterval(t);
      unsubWooReminders();
    };
  }, []);

  const activePendingExpenses = [
    ...pendingExpenses,
    ...(isSimExpensesMode
      ? [
          {
            id: 'sim-exp-1',
            name: 'Loyer Bureau (Simulé)',
            amount: 6500,
            category: 'Loyer',
            status: 'PENDING',
          },
          {
            id: 'sim-exp-2',
            name: 'Internet Fibre ADSL (Simulé)',
            amount: 450,
            category: 'Télécom',
            status: 'PENDING',
          },
        ]
      : []),
  ];

  const activeHolidays = [
    ...holidays,
    ...(isSimHolidayMode
      ? [
          {
            id: 'sim-hol-1',
            name: 'Aïd al-Fitr (Simulation)',
            dateStr: 'Dans 2 jours',
            type: 'religious' as const,
            daysUntil: 2,
          },
        ]
      : []),
  ]
    .filter((hol) => !dismissedHolidays.includes(hol.id))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleDismiss = () => {
    dismissZakatReminderForYear();
    setIsOpen(false);
  };

  const activeOverdueOrders = !isOverdueNotifDismissed ? overdueWooOrders : [];
  const overdueWooCount = activeOverdueOrders.length;

  const totalNotifCount =
    (reminderActive ? 1 : 0) +
    (activePendingExpenses.length > 0 && !isExpensesNotifDismissed ? activePendingExpenses.length : 0) +
    activeHolidays.length +
    pendingWooCount +
    overdueWooCount;

  const hasNotif = totalNotifCount > 0;

  const getNotifColorClass = () => {
    if (overdueWooCount > 0) return 'bg-[#ff3e1d]'; // Red for overdue orders
    if (activePendingExpenses.length > 0 && !isExpensesNotifDismissed) return 'bg-[#ff3e1d]'; // Red for charges
    if (pendingWooCount > 0) return 'bg-[#696cff]'; // Indigo for WooCommerce
    if (reminderActive) return 'bg-[#ffab00]'; // Amber for Zakat
    if (activeHolidays.length > 0) return 'bg-[#71dd37]'; // Green for holidays
    return 'bg-[#ff3e1d]';
  };

  return (
    <div className="relative flex flex-col items-center" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-10 h-10 rounded-md transition-all flex items-center justify-center shrink-0 cursor-pointer relative ${
          isOpen
            ? 'bg-[#f5f5f9] dark:bg-[#323249] text-[#696cff] dark:text-[#b1b4ff]'
            : 'text-[#697a8d] dark:text-[#a3a4cc] hover:bg-[#f5f5f9] dark:hover:bg-[#323249]'
        } border-0`}
        title="Notifications et alertes"
      >
        <Bell size={19} strokeWidth={1.8} />
        {hasNotif && (
          <span className="absolute -top-1 -right-1 z-10 flex items-center justify-center">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${getNotifColorClass()}`}
            />
            <span
              className={`relative inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black text-white ${getNotifColorClass()} shadow-sm border-2 border-white dark:border-[#2b2c40] leading-none`}
            >
              {totalNotifCount > 9 ? '9+' : totalNotifCount}
            </span>
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-[52px] w-[320px] bg-[#ffffff]/95 dark:bg-[#2b2c40]/95 backdrop-blur-xl border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xl z-[2000] overflow-hidden text-left"
          >
            <div className="px-4 py-3 border-b border-[#dbdade]/30 dark:border-[#434460]/20 bg-transparent flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#697a8d] dark:text-[#a3a4cc]">
                  Notifications
                </span>
                {totalNotifCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-[#ff3e1d]/10 text-[#ff3e1d] rounded text-[10px] font-extrabold">
                    {totalNotifCount}
                  </span>
                )}
              </div>
              <span className="px-2 py-0.5 bg-[#e7e7ff] dark:bg-[#393a59] text-[#696cff] dark:text-[#b1b4ff] rounded-md text-[9px] font-bold uppercase tracking-wider">
                Centre d'alertes
              </span>
            </div>

            <div className="p-2 space-y-2 max-h-[340px] overflow-y-auto custom-scrollbar">
              {reminderActive && (
                <div className="bg-[#fff2e1] dark:bg-[#4b3e2e] p-3 rounded-lg space-y-3 shadow-xs">
                  <div className="flex items-start gap-2.5">
                    <div className="bg-[#ffab00] text-white p-1 rounded rounded-md shrink-0 mt-0.5 shadow-sm">
                      <Heart className="w-3.5 h-3.5 fill-white" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[11px] font-bold text-[#ffab00] uppercase tracking-wider">
                        RAPPEL ANNUEL DE ZAKAT
                      </h4>
                      <p className="text-xs text-[#697a8d] dark:text-[#dbdade] font-semibold leading-relaxed">
                        Le{' '}
                        <span className="font-bold text-[#ffab00] border-b border-dashed border-[#ffab00]/40">
                          20 Mouharram {isSimulated && '(Simulation)'}
                        </span>{' '}
                        est arrivé. Pensez à distribuer vos enveloppes de Zakat annuelles
                        programmées.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        navigate('/zakat');
                      }}
                      className="flex-1 py-1.5 px-3 bg-[#ffab00] hover:bg-[#e69a00] text-white font-bold text-[10px] uppercase tracking-wider rounded transition-all shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <span>GÉRER LA ZAKAT</span>
                      <ArrowRight size={11} />
                    </button>
                    <button
                      onClick={handleDismiss}
                      className="py-1.5 px-3 bg-[#ffffff] dark:bg-[#323249] hover:bg-[#f5f5f9] text-[#697a8d] dark:text-[#a3a4cc] border border-[#dbdade]/70 dark:border-[#434460]/40 font-bold text-[10px] uppercase tracking-wider rounded transition-all"
                    >
                      Plus tard
                    </button>
                  </div>
                </div>
              )}

              {reminderActive &&
                !isSimDismissed &&
                (() => {
                  const simInfo = detectZakatSimulation(zakatTemplates);
                  if (!simInfo) return null;
                  return (
                    <div className="bg-gradient-to-r from-brand-50 to-indigo-50/50 border border-brand-200 rounded-2xl p-3 space-y-3 shadow-sm text-left">
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 bg-brand-600 text-white rounded-lg shrink-0 mt-0.5 shadow-md shadow-brand-500/10">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-[11px] font-bold text-brand-950 uppercase tracking-wider">
                            SIMULATION NOUVEL EXERCICE
                          </h4>
                          <p className="text-xs text-slate-600 font-semibold leading-relaxed">
                            L'enveloppe de Zakat pour l'année n'est pas encore saisie.
                            Clonez/ajustez l'enveloppe précédente{' '}
                            <strong className="text-brand-900">
                              "{simInfo.previousName}" (
                              {simInfo.previousAmount.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              DH)
                            </strong>{' '}
                            pour initialiser rapidement.
                          </p>
                        </div>
                      </div>

                      <div className="pt-1 flex gap-2">
                        <button
                          onClick={() => {
                            setIsOpen(false);
                            navigate('/zakat', { state: { autoClone: simInfo } });
                          }}
                          className="flex-1 py-2 px-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-[10px] uppercase tracking-wider rounded-lg text-center transition-all shadow-md flex items-center justify-center gap-1.5"
                        >
                          <Copy size={11} />
                          <span>CLONER</span>
                        </button>
                        <button
                          onClick={() => {
                            const currentYear = getIslamicDate().year;
                            localStorage.setItem(`zakat_sim_dismissed_year_${currentYear}`, 'true');
                            window.dispatchEvent(new Event('zakatSimulationChange'));
                          }}
                          className="py-2 px-3 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-700 border border-slate-200 font-bold text-[10px] uppercase tracking-wider rounded-lg text-center transition-all"
                        >
                          Masquer
                        </button>
                      </div>
                    </div>
                  );
                })()}

              {activePendingExpenses.length > 0 && !isExpensesNotifDismissed && (
                <div className="bg-[#ffe1e1] dark:bg-[#4b2e2e] p-3 rounded-lg space-y-3 shadow-xs text-left relative">
                  <button
                    onClick={() => {
                      setIsExpensesNotifDismissed(true);
                      sessionStorage.setItem('expenses_notif_dismissed', 'true');
                    }}
                    className="absolute top-2 right-2 text-[#ff3e1d] hover:bg-[#ff3e1d]/10 rounded transition-colors"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                  <div className="flex items-start gap-2.5">
                    <div className="bg-[#ff3e1d] text-white p-1 rounded-md shrink-0 mt-0.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[11px] font-bold text-[#ff3e1d] uppercase tracking-wider">
                        CHARGES À VALIDER
                      </h4>
                      <p className="text-xs text-[#697a8d] dark:text-[#dbdade] font-semibold leading-relaxed">
                        Il y a{' '}
                        <span className="font-bold text-[#ff3e1d]">
                          {activePendingExpenses.length} charge
                          {activePendingExpenses.length > 1 ? 's' : ''}
                        </span>{' '}
                        ce mois-ci en attente.
                      </p>
                    </div>
                  </div>

                  <div className="pt-1 flex">
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        navigate('/expenses');
                      }}
                      className="flex-1 py-1.5 px-3 bg-[#ff3e1d] hover:bg-[#e6381a] text-white font-bold text-[10px] uppercase tracking-wider rounded transition-all shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <span>VALIDER LES DÉPENSES</span>
                      <ArrowRight size={11} />
                    </button>
                  </div>
                </div>
              )}

              {overdueWooCount > 0 && !isOverdueNotifDismissed && (
                <div className="bg-[#ffe1e1] dark:bg-[#4b2e2e] p-3 rounded-lg space-y-3 shadow-xs text-left relative">
                  <button
                    onClick={() => {
                      setIsOverdueNotifDismissed(true);
                      sessionStorage.setItem('woo_overdue_notif_dismissed', 'true');
                    }}
                    className="absolute top-2 right-2 text-[#ff3e1d] hover:bg-[#ff3e1d]/10 rounded transition-colors"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>

                  <div className="flex items-start gap-2.5">
                    <div className="bg-[#ff3e1d] text-white p-1 rounded-md shrink-0 mt-0.5">
                      <Clock className="w-3.5 h-3.5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[11px] font-bold text-[#ff3e1d] uppercase tracking-wider">
                        COMMANDES EN RETARD (+2J)
                      </h4>
                      <p className="text-xs text-[#697a8d] dark:text-[#dbdade] font-semibold leading-relaxed">
                        Il y a{' '}
                        <span className="font-bold text-[#ff3e1d]">
                          {overdueWooCount} commande{overdueWooCount > 1 ? 's' : ''}
                        </span>{' '}
                        non terminée{overdueWooCount > 1 ? 's' : ''}.
                      </p>
                    </div>
                  </div>

                  <div className="pt-1 flex">
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        navigate('/woocommerce-orders', { state: { statusFilter: 'overdue_2d' } });
                      }}
                      className="flex-1 py-1.5 px-3 bg-[#ff3e1d] hover:bg-[#e6381a] text-white font-bold text-[10px] uppercase tracking-wider rounded transition-all shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <span>TRAITER LES COMMANDES</span>
                      <ArrowRight size={11} />
                    </button>
                  </div>
                </div>
              )}

              {pendingWooCount > 0 && (
                <div className="bg-[#eef2ff] dark:bg-[#2e2f4a] p-3 rounded-lg space-y-3 shadow-xs text-left relative border border-[#696cff]/20">
                  <div className="flex items-start gap-2.5">
                    <div className="bg-[#696cff] text-white p-1 rounded-md shrink-0 mt-0.5">
                      <ShoppingCart className="w-3.5 h-3.5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[11px] font-bold text-[#696cff] dark:text-[#888aff] uppercase tracking-wider">
                        ACOMPTES WOOCOMMERCE
                      </h4>
                      <p className="text-xs text-[#697a8d] dark:text-[#dbdade] font-semibold leading-relaxed">
                        <span className="font-bold text-[#696cff] dark:text-[#888aff]">
                          {pendingWooCount} commande{pendingWooCount > 1 ? 's' : ''}
                        </span>{' '}
                        nécessite{pendingWooCount > 1 ? 'nt' : ''} un acompte sans relance envoyée.
                      </p>
                    </div>
                  </div>

                  <div className="pt-1 flex">
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        navigate('/woocommerce-orders');
                      }}
                      className="flex-1 py-1.5 px-3 bg-[#696cff] hover:bg-[#5f61e6] text-white font-bold text-[10px] uppercase tracking-wider rounded transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>VOIR LES COMMANDES</span>
                      <ArrowRight size={11} />
                    </button>
                  </div>
                </div>
              )}

              {activeHolidays.length > 0 && (
                <div className="bg-transparent dark:bg-transparent dark: space-y-2.5 shadow-sm text-left">
                  <div className="flex items-center gap-2">
                    <Calendar size={12} className="text-[#71dd37] dark:text-[#71dd37]" />
                    <h4 className="text-[10px] font-bold text-emerald-900 uppercase tracking-widest">
                      Jours Fériés & Vacances
                    </h4>
                  </div>
                  <div className="space-y-1.5">
                    {activeHolidays.map((hol) => (
                      <div
                        key={hol.id}
                        className="flex justify-between items-center bg-white border border-transparent dark:border-transparent p-2 rounded-xl shadow-xs relative group"
                      >
                        <button
                          onClick={() => {
                            const newDismissed = [...dismissedHolidays, hol.id];
                            setDismissedHolidays(newDismissed);
                            sessionStorage.setItem(
                              'dismissed_holidays',
                              JSON.stringify(newDismissed)
                            );
                          }}
                          className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 text-[#71dd37] dark:text-[#71dd37] hover:text-[#71dd37] dark:text-[#71dd37] bg-transparent dark:bg-transparent transition-all hover: dark: shadow-sm"
                        >
                          <X size={12} strokeWidth={3} />
                        </button>
                        <div>
                          <p className="text-xs font-bold text-emerald-950 pr-4">{hol.name}</p>
                          <p className="text-[10px] text-[#71dd37] dark:text-[#71dd37] font-semibold uppercase">
                            {hol.dateStr}
                          </p>
                        </div>
                        <span className="text-[10px] bg-transparent dark:bg-transparent text-[#71dd37] dark:text-[#71dd37] font-bold uppercase tracking-wider whitespace-nowrap">
                          {hol.daysUntil === 0 ? "Aujourd'hui" : `Dans ${hol.daysUntil} j`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasNotif && (
                  <div className="py-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                    <Check className="w-6 h-6 text-[#71dd37] dark:text-[#71dd37] bg-transparent dark:bg-transparent mx-auto mb-2 dark:" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">A jour</span>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Aucun rappel urgent en ce moment.
                    </p>
                  </div>
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
