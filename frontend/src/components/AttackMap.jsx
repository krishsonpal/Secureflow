import React, { useState, useEffect, useMemo } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.jsx';
import { Globe } from 'lucide-react';
import { analyticsApi } from '../lib/analyticsApi';
import worldTopo from '../assets/world-110m.json';
import isoNumericToAlpha2 from '../assets/isoNumericToAlpha2.json';

// Phase 3.12 (Dashboard V2) — Attack Map. Choropleth of attack origins by country
// over the getGeo breakdown. Topojson + numeric→ISO-2 join table are vendored
// under src/assets (no runtime CDN). Geo is populated by the usage worker only
// when GeoLite2 is configured, so an all-empty breakdown shows an enable-GeoLite2
// state rather than a blank world.

// Gray (zero) → red (high), on a log scale so a few high-volume countries don't
// wash out the rest.
const LOW = [75, 85, 99];    // gray-600-ish
const HIGH = [239, 68, 68];  // red-500
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const fillFor = (count, max) => {
  if (!count) return '#1f2937'; // gray-800 (no attacks)
  const t = Math.log(count + 1) / Math.log(max + 1);
  return `rgb(${lerp(LOW[0], HIGH[0], t)}, ${lerp(LOW[1], HIGH[1], t)}, ${lerp(LOW[2], HIGH[2], t)})`;
};

const AttackMap = ({ projectId, hours = 24 }) => {
  const [breakdown, setBreakdown] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null); // { name, count, x, y }

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true); setErr('');
    analyticsApi.getGeo(projectId, { hours })
      .then((data) => { if (!cancelled) setBreakdown(data.breakdown || []); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, hours]);

  const { counts, max, total } = useMemo(() => {
    const counts = {};
    let max = 0, total = 0;
    for (const r of breakdown) { counts[r.country] = r.count; max = Math.max(max, r.count); total += r.count; }
    return { counts, max, total };
  }, [breakdown]);

  const empty = !loading && total === 0;

  return (
    <Card>
      <CardHeader className="pb-3 border-b border-gray-800">
        <CardTitle className="flex items-center gap-2">
          <Globe size={18} className="text-blue-500" />
          Attack Map
          <span className="text-xs font-normal text-gray-500 ml-1">last {hours}h · {total} threat{total === 1 ? '' : 's'}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
        {empty ? (
          <div className="text-sm text-gray-500 py-10 text-center">
            <Globe size={40} className="mx-auto mb-3 opacity-20" />
            No attack origins yet.
            <div className="text-xs mt-1">Geo is resolved from client IPs via GeoLite2 — set <code className="text-blue-400">GEOLITE2_CITY_DB</code> and drive some threats to populate the map.</div>
          </div>
        ) : (
          <div className="relative">
            <ComposableMap projectionConfig={{ scale: 145 }} height={380} style={{ width: '100%', height: 'auto' }}>
              <Geographies geography={worldTopo}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const a2 = isoNumericToAlpha2[String(Number(geo.id))];
                    const count = (a2 && counts[a2]) || 0;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fillFor(count, max)}
                        stroke="#0b1220"
                        strokeWidth={0.4}
                        style={{
                          default: { outline: 'none' },
                          hover: { outline: 'none', fill: count ? '#f59e0b' : '#374151' },
                          pressed: { outline: 'none' },
                        }}
                        onMouseEnter={(e) => setHover({ name: geo.properties.name, count, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })
                }
              </Geographies>
            </ComposableMap>

            {hover && (
              <div className="fixed z-50 pointer-events-none bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-100 shadow-lg"
                style={{ left: hover.x + 12, top: hover.y + 12 }}>
                <span className="font-medium">{hover.name}</span>
                <span className="text-gray-400 ml-2">{hover.count} threat{hover.count === 1 ? '' : 's'}</span>
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-2 mt-2 justify-end">
              <span className="text-[10px] text-gray-500">low</span>
              <div className="h-2 w-28 rounded" style={{ background: `linear-gradient(to right, ${fillFor(1, max)}, ${fillFor(max, max)})` }} />
              <span className="text-[10px] text-gray-500">high ({max})</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AttackMap;
