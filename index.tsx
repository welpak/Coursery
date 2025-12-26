
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Wind, 
  Target, 
  Edit3, 
  ChevronRight, 
  ChevronLeft,
  Trophy,
  Layers,
  Info
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'framer-motion';
// Fix: Import Leaflet to resolve 'L' is not defined errors
import L from 'leaflet';

// --- Constants & Henderson CC Data ---
const CLUBS = [
  { id: 'DR', name: 'Driver', base: 265 },
  { id: '3W', name: '3-Wood', base: 235 },
  { id: '4I', name: '4-Iron', base: 205 },
  { id: '7I', name: '7-Iron', base: 170 },
  { id: '9I', name: '9-Iron', base: 145 },
  { id: 'PW', name: 'Pitching Wedge', base: 125 },
  { id: 'SW', name: 'Sand Wedge', base: 100 },
];

const SHAPES = [
  { id: 'straight', name: 'Straight', factor: 1.0, spin: 1.0, roll: 1.0 },
  { id: 'draw', name: 'Draw', factor: 1.02, spin: 0.9, roll: 1.2 },
  { id: 'fade', name: 'Fade', factor: 0.95, spin: 1.2, roll: 0.8 },
];

const HEIGHTS = [
  { id: 'std', name: 'Standard', windSens: 1.0 },
  { id: 'high', name: 'High', windSens: 1.6 },
  { id: 'stinger', name: 'Stinger', windSens: 0.4 },
];

// Fix: Added Hole interface to correctly type tee and green as [number, number] tuples
interface Hole {
  number: number;
  par: number;
  hcp: number;
  length: number;
  tee: [number, number];
  green: [number, number];
}

// Actual Latitude/Longitude for Henderson Country Club, NC
const HOLES: Hole[] = [
  {
    number: 1, par: 5, hcp: 5, length: 505,
    tee: [36.3188, -78.3843],
    green: [36.3226, -78.3837],
  },
  {
    number: 2, par: 3, hcp: 13, length: 175,
    tee: [36.3227, -78.3835],
    green: [36.3221, -78.3815],
  }
];

// --- Utilities ---
const getDistanceYards = (coords1: [number, number], coords2: [number, number]) => {
  const R = 6371e3; // metres
  const φ1 = coords1[0] * Math.PI / 180;
  const φ2 = coords2[0] * Math.PI / 180;
  const Δφ = (coords2[0] - coords1[0]) * Math.PI / 180;
  const Δλ = (coords2[1] - coords1[1]) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round((R * c) * 1.09361); // to yards
};

// --- Components ---

const Card = ({ children, className = "", onClick }: { children?: React.ReactNode; className?: string; onClick?: () => void }) => (
  <div className={`bg-[#fdfaf1] vintage-border p-6 relative ${className}`} onClick={onClick}>
    <div className="absolute inset-0 border-[0.5px] border-[#1a2b4b]/20 pointer-events-none m-1" />
    {children}
  </div>
);

const SectionHeader = ({ title, icon: Icon }: { title: string; icon?: any }) => (
  <div className="border-b-2 border-[#1a2b4b] mb-4 pb-1 flex justify-between items-center">
    <h2 className="text-xl font-bold tracking-tight uppercase">{title}</h2>
    {Icon && <Icon size={16} className="text-[#1a2b4b]/40" />}
  </div>
);

const App = () => {
  const [currentHoleIdx, setCurrentHoleIdx] = useState(0);
  const hole = HOLES[currentHoleIdx];
  const [playerPosition, setPlayerPosition] = useState<[number, number]>(hole.tee);
  const [wind, setWind] = useState(12);
  const [windDir, setWindDir] = useState(0); // 0 = North
  const [selectedClub, setSelectedClub] = useState(CLUBS[0]);
  const [selectedShape, setSelectedShape] = useState(SHAPES[0]);
  const [selectedHeight, setSelectedHeight] = useState(HEIGHTS[0]);
  const [showScorecard, setShowScorecard] = useState(false);
  const [caddyNote, setCaddyNote] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  const mapRef = useRef<any>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('satellite-map', {
        zoomControl: false,
        attributionControl: false
      }).setView(hole.tee, 17);

      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
      }).addTo(mapRef.current);
    } else {
      mapRef.current.setView(hole.tee, 17);
    }

    // Map Click to move player
    mapRef.current.off('click');
    mapRef.current.on('click', (e: any) => {
      setPlayerPosition([e.latlng.lat, e.latlng.lng]);
    });
  }, [hole]);

  // Handle Player Marker
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.eachLayer((layer: any) => {
        if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
          mapRef.current.removeLayer(layer);
        }
      });

      // Player Marker
      L.circleMarker(playerPosition, { radius: 8, color: '#1a2b4b', fillColor: '#fff', fillOpacity: 1 }).addTo(mapRef.current);
      
      // Green Marker
      L.circleMarker(hole.green, { radius: 10, color: '#2d5a27', fillColor: 'transparent', weight: 3 }).addTo(mapRef.current);
      
      // Line
      L.polyline([playerPosition, hole.green], { color: 'white', weight: 1, dashArray: '5, 10' }).addTo(mapRef.current);
    }
  }, [playerPosition, hole]);

  // --- Physics ---
  const stats = useMemo(() => {
    // Fix: Using correctly typed hole.green from Hole interface
    const toPin = getDistanceYards(playerPosition, hole.green);
    
    // Wind Angle Math
    const targetBearing = Math.atan2(hole.green[1] - playerPosition[1], hole.green[0] - playerPosition[0]);
    const relWindAngle = (windDir * Math.PI / 180) - targetBearing;
    
    const headwindComp = Math.cos(relWindAngle) * wind;
    const crosswindComp = Math.sin(relWindAngle) * wind;

    // Club Performance
    const baseCarry = selectedClub.base * selectedShape.factor;
    const carryAdjustment = -(headwindComp * 1.8 * selectedHeight.windSens); 
    const finalCarry = Math.round(baseCarry + carryAdjustment);
    const sideDrift = Math.round(crosswindComp * 1.2 * selectedHeight.windSens);

    return { toPin, finalCarry, sideDrift };
  }, [playerPosition, hole, wind, windDir, selectedClub, selectedShape, selectedHeight]);

  const askCaddy = async () => {
    setIsThinking(true);
    setCaddyNote(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Henderson Country Club, NC. 1925 professional advice.
        Hole ${hole.number} (Par ${hole.par}).
        Target is ${stats.toPin} yards away.
        I am hitting a ${selectedClub.name} with a ${selectedShape.name} shape.
        Trajectory: ${selectedHeight.name}.
        Wind: ${wind} MPH.
        
        Write a 40-word max gentlemanly caddy tip. Mention Henderson CC specifically.
      `;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      setCaddyNote(response.text || "Play it bold, sir.");
    } catch (e) {
      setCaddyNote("Signal's gone a bit foggy, sir.");
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center max-w-7xl mx-auto pb-32">
      {/* Title Header */}
      <div className="w-full text-center mb-10">
        <h1 className="text-4xl font-black uppercase tracking-widest border-b-4 border-double border-[#1a2b4b] inline-block pb-2">
          Henderson Country Club
        </h1>
        <p className="mt-2 text-sm uppercase tracking-[0.4em] font-bold text-[#2d5a27] opacity-80">
          Field Operations • Est. 1923
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
        
        {/* Left: Satellite Map Book */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <Card className="h-[650px] flex flex-col p-2">
            <div className="flex-1 overflow-hidden relative group">
              <div id="satellite-map" className="z-0 h-full w-full" />
              
              {/* Map Overlays */}
              <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2">
                 <div className="bg-[#fdfaf1] vintage-border px-4 py-2">
                    <span className="text-xs font-black uppercase text-[#1a2b4b]">GPS LOCK: HENDERSON-01</span>
                 </div>
              </div>

              <div className="absolute bottom-4 right-4 z-[1000]">
                 <button 
                  onClick={() => setPlayerPosition(hole.tee)}
                  className="bg-[#1a2b4b] text-[#fdfaf1] p-3 shadow-xl hover:scale-110 transition-transform"
                 >
                   <MapPin size={20} />
                 </button>
              </div>

              {/* Data Strip */}
              <div className="absolute top-0 right-0 left-0 bg-[#1a2b4b]/80 text-white p-2 z-[1000] flex justify-around text-[10px] font-bold tracking-widest uppercase">
                <span>LAT: {playerPosition[0].toFixed(4)}</span>
                <span>LON: {playerPosition[1].toFixed(4)}</span>
                <span>ALT: 480 FT</span>
              </div>
            </div>
            <div className="p-4 flex justify-between items-center bg-[#1a2b4b]/5">
               <div className="flex flex-col">
                  <span className="text-[10px] font-bold opacity-40 uppercase">Satellite Feed</span>
                  <span className="text-sm font-bold uppercase">Esri World Imagery (High Res)</span>
               </div>
               <Layers size={18} className="text-[#1a2b4b]" />
            </div>
          </Card>

          <Card className="p-4 bg-white/50 border-dashed">
             <div className="flex items-center gap-2 mb-2">
                <Edit3 size={16} />
                <span className="font-bold uppercase text-xs tracking-widest text-[#2d5a27]">Caddy's Field Notes</span>
             </div>
             {isThinking ? (
               <p className="cursive text-lg">Thinking it through, sir...</p>
             ) : (
               <p className="cursive text-xl leading-relaxed text-[#1a2b4b]">
                 {caddyNote || `Hole ${hole.number} is a testing Par ${hole.par}. Keep your drive right of the center to avoid those trees on the bend.`}
               </p>
             )}
             <button onClick={askCaddy} className="mt-4 w-full border-2 border-[#1a2b4b] py-3 uppercase font-black text-xs hover:bg-[#1a2b4b] hover:text-white transition-all shadow-md active:translate-y-1">
               Consult the Club Pro
             </button>
          </Card>
        </div>

        {/* Right: Tactical Controls */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-6">
            <Card className="bg-[#1a2b4b] text-white">
              <SectionHeader title="Distances" icon={Target} />
              <div className="space-y-4">
                <div className="flex justify-between items-baseline border-b border-white/20 pb-2">
                  <span className="text-[10px] font-bold opacity-60">TO PIN</span>
                  <span className="text-5xl font-black">{stats.toPin}<small className="text-sm ml-1">Y</small></span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] font-bold opacity-60">EST. CARRY</span>
                  <span className="text-3xl font-bold text-[#2d5a27]">{stats.finalCarry}<small className="text-sm ml-1">Y</small></span>
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeader title="Meteorology" icon={Wind} />
              <div className="space-y-6 mt-4">
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-2">
                    <span>VELOCITY</span>
                    <span>{wind} MPH</span>
                  </div>
                  <input type="range" min="0" max="40" value={wind} onChange={e => setWind(Number(e.target.value))} className="w-full" />
                </div>
                <div>
                   <div className="flex justify-between text-[10px] font-bold mb-2">
                    <span>BEARING</span>
                    <span>{windDir}°</span>
                  </div>
                  <input type="range" min="0" max="360" value={windDir} onChange={e => setWindDir(Number(e.target.value))} className="w-full" />
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <SectionHeader title="The Toolset" icon={Info} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <p className="text-[10px] font-black uppercase mb-4 opacity-40">Select Iron/Wood</p>
                <div className="grid grid-cols-3 gap-2">
                  {CLUBS.map(c => (
                    <button 
                      key={c.id} 
                      onClick={() => setSelectedClub(c)}
                      className={`py-3 text-xs font-black border-2 transition-all ${selectedClub.id === c.id ? 'bg-[#1a2b4b] text-white border-[#1a2b4b]' : 'border-[#1a2b4b]/20 hover:border-[#1a2b4b]'}`}
                    >
                      {c.id}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-6">
                 <div>
                    <p className="text-[10px] font-black uppercase mb-3 opacity-40">Ball Flight Shape</p>
                    <div className="flex gap-2">
                      {SHAPES.map(s => (
                        <button key={s.id} onClick={() => setSelectedShape(s)} className={`flex-1 py-2 text-[10px] uppercase font-bold border-2 ${selectedShape.id === s.id ? 'bg-[#2d5a27] text-white border-[#2d5a27]' : 'border-[#1a2b4b]/20'}`}>{s.name}</button>
                      ))}
                    </div>
                 </div>
                 <div>
                    <p className="text-[10px] font-black uppercase mb-3 opacity-40">Launch Trajectory</p>
                    <div className="flex gap-2">
                      {HEIGHTS.map(h => (
                        <button key={h.id} onClick={() => setSelectedHeight(h)} className={`flex-1 py-2 text-[10px] uppercase font-bold border-2 ${selectedHeight.id === h.id ? 'bg-[#2d5a27] text-white border-[#2d5a27]' : 'border-[#1a2b4b]/20'}`}>{h.name}</button>
                      ))}
                    </div>
                 </div>
              </div>
            </div>
          </Card>

          <Card className="cursor-pointer hover:bg-[#1a2b4b]/5 transition-colors" onClick={() => setShowScorecard(true)}>
             <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                   <div className="bg-[#1a2b4b] text-white p-3">
                      <Trophy size={20} />
                   </div>
                   <div>
                      <span className="font-black uppercase tracking-tighter text-xl">Tournament Scorecard</span>
                      <p className="text-[10px] font-bold opacity-40 uppercase">Official Match Ledger</p>
                   </div>
                </div>
                <ChevronRight className="text-[#1a2b4b]/40" />
             </div>
          </Card>
        </div>
      </div>

      {/* Scorecard Ledger Overlay */}
      <AnimatePresence>
        {showScorecard && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-[#1a2b4b]/60 backdrop-blur-md"
          >
            <motion.div 
              initial={{ y: 50, scale: 0.95 }} animate={{ y: 0, scale: 1 }}
              className="w-full max-w-4xl"
            >
              <Card className="shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h2 className="text-4xl font-black italic uppercase tracking-tighter">Henderson C.C.</h2>
                    <p className="text-xs font-bold opacity-40 uppercase">Official Scorecard • Amateur Division</p>
                  </div>
                  <button onClick={() => setShowScorecard(false)} className="text-3xl font-light hover:rotate-90 transition-transform p-2">✕</button>
                </div>
                
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-y-2 border-[#1a2b4b] bg-[#1a2b4b]/5">
                      <th className="p-4 text-xs font-black uppercase text-left">Hole</th>
                      {[1,2,3,4,5,6,7,8,9].map(n => <th key={n} className="p-4 text-sm font-bold">{n}</th>)}
                      <th className="p-4 text-xs font-black uppercase">Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="ledger-line">
                      <td className="p-4 text-[10px] font-black uppercase text-[#2d5a27]">Par</td>
                      <td className="p-4 font-black">5</td> 
                      <td className="p-4 font-black">3</td>
                      {[4,4,5,3,4,4,4].map((p, i) => <td key={i} className="p-4 font-bold opacity-30">{p}</td>)}
                      <td className="p-4 font-black">36</td>
                    </tr>
                    <tr className="ledger-line">
                      <td className="p-4 text-[10px] font-black uppercase text-[#1a2b4b]">Score</td>
                      {[1,2,3,4,5,6,7,8,9].map(n => (
                        <td key={n} className="p-2">
                          <input 
                            type="number" 
                            className="w-10 h-10 text-center font-black text-xl bg-white border-2 border-[#1a2b4b]/10 focus:border-[#1a2b4b] outline-none rounded-none"
                            placeholder="-"
                          />
                        </td>
                      ))}
                      <td className="p-4 font-black text-2xl">--</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation Footer */}
      <div className="fixed bottom-10 left-0 right-0 flex justify-center z-[1500] pointer-events-none">
        <div className="flex items-center gap-6 bg-[#fdfaf1] vintage-border p-2 pointer-events-auto">
          <button 
            onClick={() => setCurrentHoleIdx(prev => Math.max(0, prev - 1))}
            className="w-14 h-14 bg-[#1a2b4b] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
          >
            <ChevronLeft size={24} />
          </button>
          
          <div className="flex flex-col items-center px-10">
             <span className="text-[10px] font-black uppercase opacity-40">Navigate Course</span>
             <span className="text-3xl font-black italic uppercase tracking-tighter">Hole {hole.number}</span>
          </div>

          <button 
            onClick={() => setCurrentHoleIdx(prev => Math.min(HOLES.length - 1, prev + 1))}
            className="w-14 h-14 bg-[#1a2b4b] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
          >
            <ChevronRight size={24} />
          </button>
        </div>
      </div>
    </div>
  );
};

// MapPin icon for re-centering
const MapPin = ({ size, className }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
);

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
