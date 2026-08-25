import React from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface SneatTopKpisProps {
  userName?: string;
  totalAmount: number;
  recoveryRate: number;
  totalSupplierPurchasesAmount: number;
  supplierPurchasesCount: number;
  supplierPeriod: 'day' | 'week' | 'month';
  setSupplierPeriod: (p: 'day' | 'week' | 'month') => void;
  supplierPurchaseSparklineData: any[];
  totalReturnsAmount: number;
  returnsCount: number;
  returnsPeriod: 'day' | 'week' | 'month';
  setReturnsPeriod: (p: 'day' | 'week' | 'month') => void;
  returnsSparklineData: any[];
  visibleWidgets?: Record<string, boolean | undefined>;
}

export const SneatTopKpis: React.FC<SneatTopKpisProps> = ({
  userName = 'SSI ABDELAZIZ',
  totalAmount,
  recoveryRate,
  totalSupplierPurchasesAmount,
  supplierPurchasesCount,
  supplierPeriod,
  setSupplierPeriod,
  supplierPurchaseSparklineData,
  totalReturnsAmount,
  returnsCount,
  returnsPeriod,
  setReturnsPeriod,
  returnsSparklineData,
  visibleWidgets = {} as Record<string, boolean | undefined>,
}) => {
  const showTrophy = visibleWidgets.trophy !== false;
  const showSuppliers = visibleWidgets.supplierPurchases !== false;
  const showReturns = visibleWidgets.returnsNotes !== false;

  if (!showTrophy && !showSuppliers && !showReturns) return null;

  return (
    <div className="flex flex-col xl:flex-row gap-4 xl:gap-[25px] w-full items-stretch justify-start">
      {/* Card 1: Congratulations / Bienvenue Trophy Card */}
      {showTrophy && (
        <div
          className={`bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-xs relative overflow-hidden flex flex-row items-stretch justify-between select-none h-[203px] w-full ${showSuppliers || showReturns ? 'xl:w-[32.55%]' : 'xl:w-full'}`}
        >
          <div className="flex flex-col justify-between items-start text-left z-10 pr-20">
            <div className="space-y-0.5">
              <h3 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] tracking-tight leading-snug">
                Félicitations {userName}! 🎉
              </h3>
              <p className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-normal leading-none font-sans">
                Performance globale des ventes.
              </p>
            </div>
            <div className="my-2">
              <p className="text-[26px] min-[390px]:text-[32px] md:text-[36px] xl:text-[22px] 2xl:text-[30px] font-mono font-bold text-[#696cff] dark:text-[#b1b4ff] tracking-tight leading-none">
                {totalAmount.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194] ml-1">
                  DH
                </span>
              </p>
              <p className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-normal font-sans mt-2">
                {recoveryRate.toFixed(1)}% encaissé 🚀
              </p>
            </div>
          </div>
          {/* Gold Trophy Cup SVG */}
          <div className="absolute right-2 bottom-0 w-24 h-24 flex items-end justify-center select-none pointer-events-none origin-bottom scale-110">
            <svg
              viewBox="0 0 120 120"
              className="w-full h-full drop-shadow-[0_4px_8px_rgba(255,171,0,0.2)]"
            >
              <path d="M15 45l2 2-2 2-2-2z" fill="#ffab00" opacity="0.8" />
              <path d="M95 30l1.5 1.5-1.5 1.5-1.5-1.5z" fill="#ffab00" />
              <path d="M100 80l2 2-2 2-2-2z" fill="#ffab00" opacity="0.6" />
              <path d="M35 100h50v6H35z" fill="#cbd5e1" />
              <path d="M42 90h36v10H42z" fill="#94a3b8" />
              <path d="M54 75h12v15H54z" fill="#ffd54f" />
              <path d="M30 35c0 0 0 40 30 40s30-40 30-40H30z" fill="#ffca28" />
              <path d="M60 35c0 0 0 40 30 40V35H60z" fill="#ffb300" />
              <path d="M35 38c0 0 5 25 25 25V38H35z" fill="#ffe082" opacity="0.35" />
              <path
                d="M30 40c-8 0-10-8-10-15s10-10 10-10v5c-5 0-5 3-5 5s0 10 5 10v5z"
                fill="#ffe082"
                stroke="#ffca28"
                strokeWidth="0.5"
              />
              <path
                d="M90 40c8 0 10-8 10-15s-10-10-10-10v5c5 0 5 3 5 5s0 10-5 10v5z"
                fill="#ffb300"
                stroke="#ffb300"
                strokeWidth="0.5"
              />
              <circle cx="60" cy="50" r="12" fill="#696CFF" />
              <path
                d="M60 42l2.5 5 5.5 0.5-4 3.5 1 5.5-5-2.5-5 2.5 1-5.5-4-3.5 5.5-0.5z"
                fill="#ffffff"
              />
              <path
                d="M10 55q5-10 12-5"
                stroke="#ff3e1d"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                opacity="0.7"
              />
              <path
                d="M105 50q-5 10-10 5"
                stroke="#03c3ec"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                opacity="0.7"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Combined Card 2 & 3: Visitors & Activity with vertical separator */}
      {(showSuppliers || showReturns) && (
        <div
          className={`bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs overflow-hidden h-auto sm:h-[203px] min-h-[203px] sm:min-h-0 grid grid-cols-1 ${showSuppliers && showReturns ? 'sm:grid-cols-2 sm:divide-x divide-[#dbdade]/70 dark:divide-[#434460]/30' : ''} ${showTrophy ? 'w-full xl:w-[67.45%]' : 'w-full'}`}
        >
          {/* Section 1: Achats Fournisseurs */}
          {showSuppliers && (
            <div className="p-5 md:p-6 flex flex-col justify-between select-none text-left h-full">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] leading-none font-sans">
                  Achats Fournisseurs
                </h3>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#323249] p-0.5 rounded-md">
                  <button
                    onClick={() => setSupplierPeriod('day')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all cursor-pointer ${
                      supplierPeriod === 'day'
                        ? 'bg-[#ffffff] dark:bg-[#232333] text-[#696CFF] dark:text-[#b1b4ff] shadow-3xs'
                        : 'text-[#a1acb8] dark:text-[#707194]'
                    }`}
                  >
                    Jour
                  </button>
                  <button
                    onClick={() => setSupplierPeriod('week')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all cursor-pointer ${
                      supplierPeriod === 'week'
                        ? 'bg-[#ffffff] dark:bg-[#232333] text-[#696CFF] dark:text-[#b1b4ff] shadow-3xs'
                        : 'text-[#a1acb8] dark:text-[#707194]'
                    }`}
                  >
                    Sem
                  </button>
                  <button
                    onClick={() => setSupplierPeriod('month')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all cursor-pointer ${
                      supplierPeriod === 'month'
                        ? 'bg-[#ffffff] dark:bg-[#232333] text-[#696CFF] dark:text-[#b1b4ff] shadow-3xs'
                        : 'text-[#a1acb8] dark:text-[#707194]'
                    }`}
                  >
                    Mois
                  </button>
                </div>
              </div>

              <div className="flex items-end justify-between w-full gap-4 mt-3">
                <div className="flex flex-col pb-1 shrink-0">
                  <span className="text-[24px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none font-mono">
                    {totalSupplierPurchasesAmount.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm font-sans font-semibold text-[#a1acb8] dark:text-[#707194] ml-0.5">
                      DH
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[12px] font-normal text-[#a1acb8] dark:text-[#707194] mt-2.5 leading-none font-sans">
                    {supplierPurchasesCount} achats cumulés
                  </span>
                </div>

                {/* Area chart sparkline on right */}
                <div className="flex flex-col items-center w-[140px] md:w-[150px] shrink-0 h-20 justify-end">
                  <div className="w-full h-[60px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                      <AreaChart
                        data={supplierPurchaseSparklineData}
                        margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
                      >
                        <defs>
                          <linearGradient id="glow-purple-grad-hp-spark" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#696CFF" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#696CFF" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        <Tooltip
                          cursor={{ stroke: '#696CFF', strokeWidth: 1, strokeDasharray: '2 2' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/40 p-1.5 rounded-md shadow-xs text-[9.5px] font-sans">
                                  <p className="font-semibold text-[#566a7f] dark:text-[#dbdade] leading-none mb-1 text-[8.5px] uppercase tracking-wider">
                                    {payload[0].payload.label}
                                  </p>
                                  <p className="font-mono font-bold text-[#696CFF] dark:text-[#b1b4ff]">
                                    {Number(payload[0].value || 0).toLocaleString('fr-FR', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}{' '}
                                    DH
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area
                          type="natural"
                          dataKey="value"
                          stroke="#696CFF"
                          strokeWidth={2}
                          fill="url(#glow-purple-grad-hp-spark)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-between w-full text-[9px] font-medium text-[#a1acb8] dark:text-[#707194] font-mono mt-1 px-1">
                    {supplierPurchaseSparklineData.map((d, index) => (
                      <span key={index} className="truncate select-none" title={d.label}>
                        {d.shortName}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 2: Retours & Pertes */}
          {showReturns && (
            <div className="p-5 md:p-6 flex flex-col justify-between select-none text-left h-full">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] leading-none font-sans">
                  Retours & Avoirs
                </h3>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#323249] p-0.5 rounded-md">
                  <button
                    onClick={() => setReturnsPeriod('day')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all cursor-pointer ${
                      returnsPeriod === 'day'
                        ? 'bg-[#ffffff] dark:bg-[#232333] text-[#71DD37] shadow-3xs'
                        : 'text-[#a1acb8] dark:text-[#707194]'
                    }`}
                  >
                    Jour
                  </button>
                  <button
                    onClick={() => setReturnsPeriod('week')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all cursor-pointer ${
                      returnsPeriod === 'week'
                        ? 'bg-[#ffffff] dark:bg-[#232333] text-[#71DD37] shadow-3xs'
                        : 'text-[#a1acb8] dark:text-[#707194]'
                    }`}
                  >
                    Sem
                  </button>
                  <button
                    onClick={() => setReturnsPeriod('month')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all cursor-pointer ${
                      returnsPeriod === 'month'
                        ? 'bg-[#ffffff] dark:bg-[#232333] text-[#71DD37] shadow-3xs'
                        : 'text-[#a1acb8] dark:text-[#707194]'
                    }`}
                  >
                    Mois
                  </button>
                </div>
              </div>

              <div className="flex items-end justify-between w-full gap-4 mt-3">
                <div className="flex flex-col pb-1 shrink-0">
                  <span className="text-[24px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none font-mono">
                    {totalReturnsAmount.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm font-sans font-semibold text-[#a1acb8] dark:text-[#707194] ml-0.5">
                      DH
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[12px] font-normal text-[#a1acb8] dark:text-[#707194] mt-2.5 leading-none font-sans">
                    {returnsCount} avoirs comptabilisés
                  </span>
                </div>

                {/* Wave Chart Sparkline on right */}
                <div className="flex flex-col items-center w-[140px] md:w-[150px] shrink-0 h-20 justify-end">
                  <div className="w-full h-[60px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                      <AreaChart
                        data={returnsSparklineData}
                        margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
                      >
                        <defs>
                          <linearGradient id="glow-green-grad-hp-spark" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#71DD37" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#71DD37" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        <Tooltip
                          cursor={{ stroke: '#71DD37', strokeWidth: 1, strokeDasharray: '2 2' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/40 p-1.5 rounded-md shadow-xs text-[9.5px] font-sans">
                                  <p className="font-semibold text-[#566a7f] dark:text-[#dbdade] leading-none mb-1 text-[8.5px] uppercase tracking-wider">
                                    {payload[0].payload.label}
                                  </p>
                                  <p className="font-mono font-bold text-[#71DD37]">
                                    {Number(payload[0].value || 0).toLocaleString('fr-FR', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}{' '}
                                    DH
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area
                          type="natural"
                          dataKey="value"
                          stroke="#71DD37"
                          strokeWidth={2}
                          fill="url(#glow-green-grad-hp-spark)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-between w-full text-[9px] font-medium text-[#a1acb8] dark:text-[#707194] font-mono mt-1 px-1">
                    {returnsSparklineData.map((d, index) => (
                      <span key={index} className="truncate select-none" title={d.label}>
                        {d.shortName}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
