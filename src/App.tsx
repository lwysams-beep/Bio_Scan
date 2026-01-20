import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Zap, Clock, Brain, RefreshCw, Camera, Fingerprint, ShieldAlert, Cpu } from 'lucide-react';

// BioFuture Scan - 未來生物掃描儀 v1.0
// 1. 使用 MediaPipe Face Mesh 進行 468 點高精度臉部掃描
// 2. 賽博龐克 (Cyberpunk) 未來風格 UI
// 3. 實時運算壓力指數與生理年齡估算

const MP_VERSION = '0.4.1633559619'; // 使用 FaceMesh 穩定版本

export default function BioFutureScanApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // 狀態管理
  const [systemState, setSystemState] = useState('IDLE'); // IDLE, SCANNING, ANALYZING, RESULT
  const [loadingStatus, setLoadingStatus] = useState("SYSTEM INITIALIZING...");
  const [scanProgress, setScanProgress] = useState(0);
  
  // 分析結果
  const [metrics, setMetrics] = useState({
    stress: 0,      // 0-100%
    age: 0,         // 歲數
    heartRate: 0,   // 模擬心率
    fatigue: 0      // 疲勞度
  });

  // AI 核心參考
  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);

  // --- 1. 自動注入 Tailwind 與 字體 ---
  useEffect(() => {
    if (!document.querySelector('script[src*="tailwindcss"]')) {
      const script = document.createElement('script');
      script.src = "https://cdn.tailwindcss.com";
      document.head.appendChild(script);
    }
    // 注入 Google Fonts (Orbitron for sci-fi look)
    const fontLink = document.createElement('link');
    fontLink.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Share+Tech+Mono&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
  }, []);

  // --- 2. 核心載入器 ---
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = "anonymous"; 
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Load failed: ${src}`));
      document.body.appendChild(script);
    });
  };

  const initAI = async () => {
    try {
      // 清除環境變數干擾
      window.process = undefined; window.exports = undefined;

      setLoadingStatus("LOADING NEURAL NETWORKS...");
      await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}/face_mesh.js`);
      
      setLoadingStatus("CALIBRATING SENSORS...");
      // 等待 FaceMesh 載入
      await new Promise(r => setTimeout(r, 1500)); 

      if (window.FaceMesh) {
        setLoadingStatus("SYSTEM READY");
        setSystemState('IDLE');
      } else {
        throw new Error("AI Core missing");
      }
    } catch (e) {
      setLoadingStatus("INIT FAILED: " + e.message);
    }
  };

  useEffect(() => { initAI(); }, []);

  // --- 3. 演算法邏輯 (模擬) ---
  const analyzeFace = (landmarks) => {
    if (!landmarks || landmarks.length < 468) return;

    // 簡單的幾何計算來模擬數據 (真實醫療需要更複雜模型)
    
    // A. 壓力偵測 (Stress): 觀察眉頭緊皺 (Landmark 107 & 336 距離)
    const frownDist = Math.abs(landmarks[107].x - landmarks[336].x);
    // 正常放鬆約 0.15 (視距離而定), 緊皺 < 0.12
    // 我們將此數值映射到 0-100 的壓力值
    let rawStress = (0.16 - frownDist) * 1000; 
    rawStress = Math.max(10, Math.min(95, rawStress)); // 限制範圍

    // B. 年齡估算 (Age): 臉型下垂度 (下巴點 152 與 兩側顴骨 234, 454 的垂直比例)
    // 這只是一個視覺幾何模擬
    const faceHeight = Math.abs(landmarks[10].y - landmarks[152].y);
    const faceWidth = Math.abs(landmarks[234].x - landmarks[454].x);
    const ratio = faceHeight / faceWidth;
    
    // 基準年齡 + 浮動
    let estimatedAge = 35 + (ratio - 1.3) * 20; 
    estimatedAge = Math.max(18, Math.min(85, estimatedAge));

    // 平滑更新數據 (以免數字跳動太快)
    setMetrics(prev => ({
        stress: Math.floor(prev.stress * 0.9 + rawStress * 0.1),
        age: Math.floor(prev.age * 0.95 + estimatedAge * 0.05),
        heartRate: 70 + Math.floor(Math.random() * 10), // 模擬微幅波動
        fatigue: Math.floor(prev.stress * 0.8 + 10)
    }));
  };

  // --- 4. 相機迴圈 ---
  const startScanning = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera API not supported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720, facingMode: "user" } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = async () => {
          videoRef.current.play();
          
          // 初始化 FaceMesh
          const faceMesh = new window.FaceMesh({locateFile: (file) => 
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}/${file}`});
          
          faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
          });

          faceMesh.onResults(onResults);
          faceMeshRef.current = faceMesh;

          setSystemState('SCANNING');
          isLooping.current = true;
          processFrame();
        };
      }
    } catch (e) {
      alert("Camera Access Denied: " + e.message);
    }
  };

  const processFrame = async () => {
    if (!isLooping.current) return;
    
    if (videoRef.current && faceMeshRef.current) {
      await faceMeshRef.current.send({image: videoRef.current});
    }
    
    requestRef.current = requestAnimationFrame(processFrame);
  };

  const onResults = (results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { width, height } = canvasRef.current;
    
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    
    // 繪製賽博龐克風格網格
    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        // 1. 繪製臉部網格 (Cyan)
        ctx.strokeStyle = '#06b6d4'; // Cyan-500
        ctx.lineWidth = 0.5;
        // 簡單繪製點陣 (為了效能不畫全網格線)
        for (let i = 0; i < landmarks.length; i+=2) { // 每隔一點畫一點，優化效能
            const x = landmarks[i].x * width;
            const y = landmarks[i].y * height;
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(6, 182, 212, 0.5)';
            ctx.fill();
        }

        // 2. 進行數據分析
        if (systemState === 'SCANNING') {
            analyzeFace(landmarks);
            // 掃描進度條增加
            setScanProgress(prev => {
                if (prev >= 100) {
                    setSystemState('ANALYZING');
                    setTimeout(() => setSystemState('RESULT'), 2000); // 2秒後顯示結果
                    return 100;
                }
                return prev + 0.5;
            });
        }
      }
    }
    ctx.restore();
  };

  // --- UI Renders ---

  const renderBackground = () => (
    <div className="absolute inset-0 z-0 overflow-hidden bg-slate-900 pointer-events-none">
       {/* 網格背景 */}
       <div className="absolute inset-0" 
            style={{
                backgroundImage: 'linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)',
                backgroundSize: '40px 40px'
            }}>
       </div>
       {/* 掃描線動畫 */}
       <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/10 to-transparent h-screen w-full animate-[scan_3s_ease-in-out_infinite]"></div>
    </div>
  );

  // 1. 待機/歡迎畫面
  if (systemState === 'IDLE') {
    return (
      <div className="relative w-full h-screen bg-slate-900 text-cyan-400 font-mono flex flex-col items-center justify-center overflow-hidden">
        {renderBackground()}
        
        <div className="z-10 flex flex-col items-center">
           <div className="mb-8 relative">
              <div className="absolute inset-0 bg-cyan-500 blur-xl opacity-30 animate-pulse"></div>
              <Scan className="w-24 h-24 text-cyan-400 animate-spin-slow" />
           </div>
           
           <h1 className="text-5xl md:text-7xl font-bold tracking-widest mb-2" style={{fontFamily: 'Orbitron'}}>BIO-SCAN</h1>
           <p className="text-sm md:text-xl tracking-[0.5em] text-cyan-600 mb-12">生物特徵分析系統 V2.0</p>
           
           <div className="border border-cyan-500/50 bg-slate-900/80 p-6 rounded-lg backdrop-blur-sm max-w-md w-full text-center mb-8 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <p className="text-xs text-slate-400 mb-2">SYSTEM STATUS</p>
              <p className="text-lg text-emerald-400 animate-pulse">{loadingStatus}</p>
           </div>

           <button 
             onClick={startScanning}
             className="group relative px-12 py-4 bg-transparent overflow-hidden rounded-none border-2 border-cyan-500 text-cyan-400 font-bold tracking-widest hover:bg-cyan-500 hover:text-slate-900 transition-all duration-300"
           >
             <span className="relative z-10 flex items-center gap-3">
               <Fingerprint className="w-6 h-6" /> START ANALYSIS
             </span>
             <div className="absolute inset-0 bg-cyan-400/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
           </button>
        </div>
        
        <div className="absolute bottom-4 text-[10px] text-cyan-700 tracking-widest">
           僅供娛樂用途 FOR ENTERTAINMENT ONLY
        </div>
      </div>
    );
  }

  // 2. 掃描與分析中畫面
  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-mono text-cyan-400">
      {/* 鏡像 Video */}
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full object-cover opacity-60" 
        style={{ transform: 'scaleX(-1)' }} 
        playsInline 
        muted 
      />
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full object-cover z-10" 
        style={{ transform: 'scaleX(-1)' }} 
        width={1280} 
        height={720} 
      />

      {/* 裝飾性 HUD 覆蓋層 */}
      <div className="absolute inset-0 z-20 pointer-events-none p-4 md:p-8 flex flex-col justify-between">
         {/* Top Bar */}
         <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
               <div className="flex items-center gap-2 text-xs text-cyan-600">
                  <Activity className="w-4 h-4" />
                  <span>LIVE FEED // 120 FPS</span>
               </div>
               <h2 className="text-2xl font-bold tracking-widest border-l-4 border-cyan-500 pl-3">BIO-METRICS</h2>
            </div>
            <div className="text-right">
               <div className="text-4xl font-bold" style={{fontFamily: 'Share Tech Mono'}}>
                  {new Date().toLocaleTimeString('en-US', {hour12: false})}
               </div>
               <div className="text-xs text-cyan-600 tracking-widest">HONG KONG SAR</div>
            </div>
         </div>

         {/* Center Target (僅在掃描時顯示) */}
         {systemState === 'SCANNING' && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-cyan-500/30 rounded-full flex items-center justify-center">
               <div className="w-60 h-60 border-2 border-cyan-400/50 rounded-full border-dashed animate-spin-slow"></div>
               <div className="absolute w-full h-[1px] bg-cyan-500/50"></div>
               <div className="absolute h-full w-[1px] bg-cyan-500/50"></div>
               <div className="absolute top-full mt-4 text-center">
                  <p className="text-lg font-bold animate-pulse">ANALYZING FACE MESH</p>
                  <p className="text-xs text-cyan-600">正在讀取微表情特徵...</p>
               </div>
            </div>
         )}

         {/* Bottom Data Panel (結果顯示) */}
         {systemState === 'RESULT' ? (
            <div className="bg-slate-900/90 border border-cyan-500 p-6 backdrop-blur-md animate-fade-in-up w-full max-w-4xl mx-auto rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.2)] pointer-events-auto">
               <div className="flex justify-between items-center mb-6 border-b border-cyan-800 pb-4">
                  <h3 className="text-3xl font-bold text-white flex items-center gap-3">
                     <Brain className="text-fuchsia-500" /> 分析報告 COMPLETE
                  </h3>
                  <button onClick={() => { setSystemState('SCANNING'); setScanProgress(0); }} className="px-4 py-2 border border-cyan-600 text-sm hover:bg-cyan-900 transition-colors flex items-center gap-2">
                     <RefreshCw className="w-4 h-4" /> RESCAN
                  </button>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* 壓力指數 */}
                  <div className="space-y-2">
                     <div className="flex justify-between text-sm text-cyan-300">
                        <span>STRESS LEVEL (壓力指數)</span>
                        <span>{metrics.stress}%</span>
                     </div>
                     <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-1000 ${metrics.stress > 70 ? 'bg-red-500 shadow-[0_0_10px_red]' : 'bg-cyan-500 shadow-[0_0_10px_cyan]'}`} style={{width: `${metrics.stress}%`}}></div>
                     </div>
                     <p className="text-xs text-slate-400 mt-2">
                        {metrics.stress > 70 ? "警告：偵測到高壓特徵。建議立即進行深呼吸。" : "狀態良好：精神壓力處於正常範圍。"}
                     </p>
                  </div>

                  {/* 生理年齡 */}
                  <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded border-l-4 border-fuchsia-500">
                     <div>
                        <div className="text-xs text-fuchsia-300 mb-1">BIOLOGICAL AGE ESTIMATE</div>
                        <div className="text-xs text-slate-400">生理年齡估算</div>
                     </div>
                     <div className="text-5xl font-bold text-white" style={{fontFamily: 'Orbitron'}}>
                        {metrics.age}<span className="text-lg text-fuchsia-500 ml-1">YR</span>
                     </div>
                  </div>

                  {/* 其他數據 */}
                  <div className="grid grid-cols-2 gap-4 md:col-span-2">
                     <div className="bg-slate-800/30 p-3 rounded flex items-center gap-3">
                        <Heart className="text-red-500 animate-pulse" />
                        <div>
                           <div className="text-2xl font-bold text-white">{metrics.heartRate}</div>
                           <div className="text-[10px] text-slate-400">EST. BPM</div>
                        </div>
                     </div>
                     <div className="bg-slate-800/30 p-3 rounded flex items-center gap-3">
                        <Zap className="text-yellow-400" />
                        <div>
                           <div className="text-2xl font-bold text-white">{100 - metrics.fatigue}%</div>
                           <div className="text-[10px] text-slate-400">ENERGY LEVEL</div>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         ) : (
            // 掃描時的底部數據流
            <div className="grid grid-cols-3 gap-4 opacity-70">
               <div className="border-t border-cyan-500/50 pt-2">
                  <div className="text-xs text-cyan-600">FACE MESH</div>
                  <div className="text-lg">Tracking...</div>
               </div>
               <div className="border-t border-cyan-500/50 pt-2">
                  <div className="text-xs text-cyan-600">PROCESSOR</div>
                  <div className="text-lg flex items-center gap-2"><Cpu className="w-4 h-4 animate-pulse" /> ONLINE</div>
               </div>
               <div className="border-t border-cyan-500/50 pt-2">
                  <div className="text-xs text-cyan-600">PROGRESS</div>
                  <div className="h-2 bg-slate-800 mt-2 overflow-hidden">
                     <div className="h-full bg-cyan-500" style={{width: `${scanProgress}%`}}></div>
                  </div>
               </div>
            </div>
         )}
      </div>
      
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-100%); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        .animate-spin-slow { animation: spin 8s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-fade-in-up { animation: fadeInUp 0.5s ease-out forwards; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}