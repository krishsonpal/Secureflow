import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.jsx';
import { Crosshair } from 'lucide-react';
import { groupByTactic } from '../lib/mitreMap';

// Phase 3.11 (Dashboard V2) — MITRE ATT&CK / OWASP board. Groups the dashboard's
// byStatus counts into kill-chain tactic columns; each technique cell shades by
// observed volume and carries its ATT&CK id + OWASP tag. Purely derived from the
// existing analytics payload (no new backend).
const cellShade = (count) => {
  if (count >= 50) return 'bg-red-500/25 border-red-500/50 text-red-200';
  if (count >= 10) return 'bg-amber-500/20 border-amber-500/40 text-amber-200';
  if (count > 0) return 'bg-blue-500/15 border-blue-500/30 text-blue-200';
  return 'bg-gray-800 border-gray-700 text-gray-400';
};

const MitreView = ({ byStatus }) => {
  const columns = groupByTactic(byStatus || {});
  const totalTechniques = columns.reduce((n, c) => n + c.techniques.length, 0);

  return (
    <Card>
      <CardHeader className="pb-3 border-b border-gray-800">
        <CardTitle className="flex items-center gap-2">
          <Crosshair size={18} className="text-blue-500" />
          MITRE ATT&CK Coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {totalTechniques === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            No mapped threats observed yet — techniques appear here as attacks are detected.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex gap-3 min-w-max">
              {columns.map((col) => (
                <div key={col.tactic} className="w-44 flex-shrink-0">
                  <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2 flex items-center justify-between">
                    <span className="truncate" title={col.tactic}>{col.tactic}</span>
                    <span className="text-gray-500">{col.total}</span>
                  </div>
                  <div className="space-y-2">
                    {col.techniques.map((t) => (
                      <div key={t.status} className={`rounded-md border p-2 ${cellShade(t.count)}`} title={`${t.technique} · ${t.mitre}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono opacity-80">{t.mitre}</span>
                          <span className="text-xs font-bold">{t.count}</span>
                        </div>
                        <div className="text-xs font-medium mt-0.5 leading-snug">{t.technique}</div>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[10px] px-1 py-0.5 rounded bg-black/30 text-gray-300">{t.status}</span>
                          {t.owasp && t.owasp !== '—' && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-black/30 text-gray-300">{t.owasp}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MitreView;
