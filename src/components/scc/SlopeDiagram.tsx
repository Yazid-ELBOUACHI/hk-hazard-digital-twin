// Animated 2.5D slope cross-section — used statically in Overview and animated in Scenario Lab.
// Pure SVG driven by phase/saturation/deformation/debris values.

import type { Slope } from "@/core/types";

export interface DiagramState {
  saturation: number; // 0..1
  deformationMm: number;
  debrisFrac: number; // 0..1 of runout distance
  phase: string;
  raining: boolean;
  failed: boolean;
}

export default function SlopeDiagram({ slope, state }: { slope: Slope; state: DiagramState }) {
  const W = 640;
  const H = 300;
  // geometry: crest at (150,60), toe at (420, 240), runout to (630, 250)
  const crest = { x: 150, y: 70 };
  const toe = { x: 400, y: 232 };
  const runoutEnd = { x: 620, y: 246 };

  const surface = `M0,${crest.y + 4} L${crest.x},${crest.y} L${toe.x},${toe.y} L${W},${toe.y + 14}`;
  const groundFill = `${surface} L${W},${H} L0,${H} Z`;

  const wtY = (f: number) => crest.y + 60 + (1 - state.saturation) * 70 * f;
  const waterTable = `M20,${wtY(1)} Q${crest.x + 60},${wtY(0.9) + 30} ${toe.x - 40},${toe.y - 12} L${toe.x + 30},${toe.y + 6}`;

  const slipVisible = state.deformationMm > 5 || state.failed;
  const slip = `M${crest.x + 20},${crest.y + 8} Q${(crest.x + toe.x) / 2 + 20},${(crest.y + toe.y) / 2 + 38} ${toe.x - 10},${toe.y - 2}`;

  const hasWall = slope.mitigations.some((m) => m.type === "retaining-wall");
  const hasBarrier = slope.mitigations.some((m) => m.type === "debris-barrier");
  const barrierX = toe.x + 90;

  // debris mass position along runout
  const df = Math.min(1, state.debrisFrac);
  const debrisX = toe.x + (runoutEnd.x - toe.x) * df;
  const stopAtBarrier = hasBarrier && debrisX > barrierX - 12 && df < 0.99;

  const sensors = slope.sensors.slice(0, 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      <defs>
        <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c3a26" />
          <stop offset="1" stopColor="#2a2118" />
        </linearGradient>
        <linearGradient id="sat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(40,110,220,0)" />
          <stop offset="1" stopColor={`rgba(40,110,220,${0.15 + state.saturation * 0.45})`} />
        </linearGradient>
        <radialGradient id="riskheat">
          <stop offset="0" stopColor="rgba(224,74,58,0.55)" />
          <stop offset="1" stopColor="rgba(224,74,58,0)" />
        </radialGradient>
      </defs>

      <rect width={W} height={H} fill="#060a10" />

      {/* rain */}
      {state.raining && (
        <g stroke="#4d9fff" strokeWidth="1.2" opacity={0.7}>
          {Array.from({ length: 26 }, (_, i) => {
            const x = 20 + i * 24;
            const y = ((i * 37) % 40) - 10;
            return <line key={i} x1={x} y1={y} x2={x - 5} y2={y + 16} />;
          })}
        </g>
      )}

      {/* ground */}
      <path d={groundFill} fill="url(#soil)" stroke="#6b5638" strokeWidth="1.5" />
      {/* saturation overlay */}
      <path d={groundFill} fill="url(#sat)" />
      {/* bedrock */}
      <path d={`M0,${crest.y + 90} Q${(crest.x + toe.x) / 2},${toe.y + 40} ${W},${toe.y + 60} L${W},${H} L0,${H} Z`} fill="#1b2330" opacity="0.85" />

      {/* water table */}
      <path d={waterTable} fill="none" stroke="#38b6d8" strokeWidth="1.6" strokeDasharray="6 4" opacity="0.9" />
      <text x="26" y={wtY(1) - 6} fill="#38b6d8" fontSize="9" fontFamily="monospace">water table</text>

      {/* risk heat zone */}
      {!state.failed && (
        <ellipse cx={(crest.x + toe.x) / 2 + 10} cy={(crest.y + toe.y) / 2 + 8} rx="90" ry="46" fill="url(#riskheat)" opacity={0.4 + state.saturation * 0.5} />
      )}

      {/* slip surface */}
      {slipVisible && (
        <path d={slip} fill="none" stroke="#ff5a2a" strokeWidth="2" strokeDasharray="7 4">
          {!state.failed && <animate attributeName="stroke-opacity" values="0.4;1;0.4" dur="1.6s" repeatCount="indefinite" />}
        </path>
      )}

      {/* deformation arrow */}
      {state.deformationMm > 2 && !state.failed && (
        <g transform={`translate(${(crest.x + toe.x) / 2},${(crest.y + toe.y) / 2 - 10})`}>
          <line x1="0" y1="0" x2="26" y2="20" stroke="#ffd76b" strokeWidth="2.4" />
          <path d="M26,20 l-8,-2 l3,-7 z" fill="#ffd76b" />
          <text x="30" y="14" fill="#ffd76b" fontSize="10" fontFamily="monospace">{state.deformationMm.toFixed(0)} mm</text>
        </g>
      )}

      {/* failed mass / debris */}
      {state.failed && df > 0.01 && (
        <g>
          <path
            d={`M${crest.x + 26},${crest.y + 14} Q${(crest.x + toe.x) / 2 + 24},${(crest.y + toe.y) / 2 + 44} ${toe.x - 6},${toe.y}`}
            fill="none" stroke="#3a2c1a" strokeWidth="3"
          />
          <ellipse
            cx={stopAtBarrier ? barrierX - 22 : debrisX}
            cy={toe.y + 10 + df * 6}
            rx={34 + df * 26}
            ry={12 + df * 5}
            fill="#7a5230" stroke="#a0522d" strokeWidth="2"
          />
          {df > 0.1 && (
            <ellipse cx={(toe.x + (stopAtBarrier ? barrierX - 30 : debrisX)) / 2} cy={toe.y + 8} rx={(debrisX - toe.x) / 2} ry={8} fill="#5d4024" opacity="0.85" />
          )}
        </g>
      )}

      {/* retaining wall */}
      {hasWall && <rect x={toe.x + 2} y={toe.y - 26} width="10" height="30" fill="#8fa2ba" stroke="#c3d0e0" strokeWidth="1" />}
      {/* debris barrier */}
      {hasBarrier && (
        <g>
          <rect x={barrierX} y={toe.y - 14} width="6" height="24" fill={stopAtBarrier ? "#e04a3a" : "#43d19a"} />
          <text x={barrierX - 18} y={toe.y - 20} fill={stopAtBarrier ? "#ff8577" : "#43d19a"} fontSize="9" fontFamily="monospace">barrier</text>
        </g>
      )}

      {/* road + building downstream */}
      <rect x={toe.x + 130} y={toe.y + 14} width="52" height="6" rx="2" fill="#5b7ea8" />
      <text x={toe.x + 134} y={toe.y + 34} fill="#5b7ea8" fontSize="9" fontFamily="monospace">road</text>
      <g transform={`translate(${toe.x + 196},${toe.y - 16})`}>
        <rect width="26" height="32" fill="#33404f" stroke="#5b7ea8" />
        <rect x="5" y="5" width="6" height="6" fill="#ffd76b" opacity="0.8" />
        <rect x="15" y="5" width="6" height="6" fill="#ffd76b" opacity="0.5" />
        <rect x="5" y="16" width="6" height="6" fill="#ffd76b" opacity="0.6" />
      </g>

      {/* sensors */}
      {sensors.map((sn, i) => {
        const t = (i + 1) / (sensors.length + 1);
        const x = crest.x + (toe.x - crest.x) * t;
        const y = crest.y + (toe.y - crest.y) * t - 4;
        return (
          <g key={sn.id}>
            <circle cx={x} cy={y} r="4" fill={sn.online ? (sn.anomalous ? "#e8c33a" : "#ffd76b") : "#7c8794"} stroke="#0c1017" strokeWidth="1.5" />
            <line x1={x} y1={y} x2={x} y2={y - 10} stroke="#ffd76b" strokeWidth="1" opacity="0.6" />
          </g>
        );
      })}

      {/* labels */}
      <text x="10" y="18" fill="#6d7a8c" fontSize="10" fontFamily="monospace">
        CROSS-SECTION (schematic, synthetic) · {slope.slopeAngleDeg}° · H={slope.heightM} m
      </text>
      <text x={W - 8} y="18" fill="#ffd76b" fontSize="10" fontFamily="monospace" textAnchor="end">
        {state.phase}
      </text>
    </svg>
  );
}
