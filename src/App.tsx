import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Zap, Clock, Brain, RefreshCw, Camera, Fingerprint, ShieldAlert, Cpu, Loader2, Play } from 'lucide-react';

// BioFuture Scan - v2.5 智能感知版
// 1. [核心修復] 改用 video.currentTime 主動偵測播放狀態，繞過 iOS video.play() Promise 卡住的問題
// 2. [優化] 移除不必要的等待，一旦偵測到畫面流動立即進入掃描模式
// 3. [體驗] 隱藏誤導性的 "Slow network" 訊息，改為更精確的狀態顯示

const MP_VERSION = '0.4.1633559619'; 

export default function BioFutureScanApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // 狀態
  const [systemState, setSystemState] = useState('IDLE'); 
  const [loadingStatus, setLoadingStatus] = useState("SYSTEM STANDBY");
  const [debugMsg, setDebugMsg] = useState(""); 
  const [showForceEntry, setShowForceEntry] = useState(false);
  
  const [metrics, setMetrics] = useState({
    stress: 0, age: 0, heartRate: 0, fatigue: 0
  });
  const [scanProgress, setScanProgress] = useState(0);

  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);
  const aiReady = useRef(false);

  // --- 1. 初始化 ---
  useEffect(() => {
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflowX = 'hidden';
    document.body.style.backgroundColor = '#0f172a';
    
    const fontLink = document.createElement('link');
    fontLink.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Share+Tech+Mono&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);

    if (!document.querySelector('script[src*="tailwindcss"]')) {
      const script = document.createElement('script');
      script.src = "https://cdn.tailwindcss.com";
      script.async = true;
      document.head.appendChild(script);
    }

    initAI();
  }, []);

  // --- 2. AI 載入 (背景執行) ---
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = "anonymous"; 
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`下載失敗`));
      document.body.appendChild(script);
    });
  };

  const initAI = async () => {
    try {
      try { if (window.process) window.process = undefined; } catch(e) {}
      
      console.log("Downloading AI...");
      await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}/face_mesh.js`);
      
      setTimeout(() => {
          if (window.FaceMesh) {
              console.log("AI Ready");
              aiReady.current = true;
          }
      }, 1000);
    } catch (e) {
      console.error("AI Load Failed (Background)", e);
    }
  };

  // --- 3. 演算法邏輯 ---
  const analyzeFace = (landmarks) => {
    if (!landmarks || landmarks.length < 468) return;

    const frownDist = Math.abs(landmarks[107].x - landmarks[336].x);
    let rawStress = (0.16 - frownDist) * 1000; 
    rawStress = Math.max(10, Math.min(95, rawStress)); 

    const faceHeight = Math.abs(landmarks[10].y - landmarks[152].y);
    const faceWidth = Math.abs(landmarks[234].x - landmarks[454].x);
    const ratio = faceHeight / faceWidth;
    let estimatedAge = 35 + (ratio - 1.3) * 20; 
    estimatedAge = Math.max(18, Math.min(85, estimatedAge));

    setMetrics(prev => ({
        stress: Math.floor(prev.stress * 0.9 + rawStress * 0.1),
        age: Math.floor(prev.age * 0.95 + estimatedAge * 0.05),
        heartRate: 70 + Math.floor(Math.random() * 10),
        fatigue: Math.floor(prev.stress * 0.8 + 10)
    }));
  };

  // --- 4. 相機啟動 (智能感知版) ---
  const startScanning = async () => {
    setSystemState('STARTING'); 
    setLoadingStatus("ACTIVATING SENSORS...");
    setDebugMsg("Initializing...");
    setShowForceEntry(false);

    // 雖然網路沒問題，還是留個後路，10秒後才顯示強制按鈕
    const safetyTimer = setTimeout(() => {
        setDebugMsg("Initialization prolonged.");
        setShowForceEntry(true);
    }, 10000);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("不支援相機 API");
      setSystemState('IDLE');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
            width: { ideal: 1280 }, 
            height: { ideal: 720 }, 
            facingMode: "user" 
        },
        audio: false 
      });
      
      setDebugMsg("Signal Locked.");

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        
        // --- 核心修復：主動播放與偵測 ---
        
        // 1. 觸發播放 (不等待 Promise)
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log("Auto-play prevented:", error);
                setDebugMsg("Auto-play paused. Re-engaging...");
            });
        }

        // 2. 智能感知迴圈：檢查影片是否真的在動
        const checkVideoInterval = setInterval(() => {
            // 如果影片有進度 (currentTime > 0) 或者已經準備好 (readyState >= 3)
            if (video.currentTime > 0 || video.readyState >= 3) {
                clearInterval(checkVideoInterval);
                clearTimeout(safetyTimer);
                setDebugMsg("Visual Feed Active");
                enterScanningMode();
            }
        }, 100); // 每 0.1 秒檢查一次，反應超快
      }
    } catch (e) {
      setDebugMsg("Sensor Error: " + e.name);
      alert("相機錯誤: " + e.message);
      setSystemState('IDLE');
    }
  };

  const enterScanningMode = () => {
      setSystemState('SCANNING');
      // 嘗試啟動 AI
      if (aiReady.current) {
          setupFaceMesh();
      } else {
          setDebugMsg("Calibrating AI...");
          // 輪詢 AI 是否準備好
          const aiCheckInterval = setInterval(() => {
              if (window.FaceMesh) {
                  clearInterval(aiCheckInterval);
                  setupFaceMesh();
              }
          }, 500);
      }
  };

  const setupFaceMesh = () => {
      if (faceMeshRef.current) return; 

      try {
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
        
        isLooping.current = true;
        setDebugMsg("System Fully Operational");
        processFrame();
      } catch(e) {
          setDebugMsg("AI Init Error: " + e.message);
      }
  };

  const processFrame = async () => {
    if (!isLooping.current) return;
    if (videoRef.current && faceMeshRef.current && !videoRef.current.paused && !videoRef.current.ended) {
      try {
        await faceMeshRef.current.send({image: videoRef.current});
      } catch (e) {} 
    }
    requestRef.current = requestAnimationFrame(processFrame);
  };

  const onResults = (results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { width, height } = canvasRef.current;
    
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    
    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        ctx.strokeStyle = '#06b6d4'; 
        ctx.lineWidth = 0.5;
        for (let i = 0; i < landmarks.length; i+=3) { 
            const x = landmarks[i].x * width;
            const y = landmarks[i].y * height;
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(6, 182, 212, 0.6)';
            ctx.fill();
        }

        setScanProgress(prev => {
            if (prev >= 100) return 100;
            analyzeFace(landmarks);
            return prev + 0.5;
        });
      }
    }
    ctx.restore();
  };

  useEffect(() => {
      if (scanProgress >= 100 && systemState === 'SCANNING') {
          setSystemState('ANALYZING');
          setTimeout(() => setSystemState('RESULT'), 2000);
      }
  }, [scanProgress, systemState]);

  const forceEntry = () => {
      setSystemState('SCANNING');
      if (videoRef.current) videoRef.current.play();
  };

  // --- UI Renders ---

  const styles = {
    wrapper: {
      backgroundColor: '#0f172a', 
      color: '#22d3ee', 
      minHeight: '100vh',
      width: '100vw',          
      maxWidth: '100%',        
      overflowX: 'hidden',     
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
      fontFamily: '"Orbitron", monospace',
      margin: 0,
      padding: 0,
      boxSizing: 'border-box'
    },
    button: {
      padding: '1.2rem 3rem',
      backgroundColor: 'rgba(6, 182, 212, 0.1)',
      border: '2px solid #06b6d4',
      color: '#22d3ee',
      fontSize: '1.2rem',
      fontWeight: 'bold',
      letterSpacing: '0.1em',
      cursor: 'pointer',
      marginTop: '2rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      zIndex: 50,              
      position: 'relative',
      touchAction: 'manipulation', 
      borderRadius: '4px',
      boxShadow: '0 0 15px rgba(6, 182, 212, 0.3)',
      width: '80%', 
      maxWidth: '300px'
    }
  };

  const renderBackground = () => (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}>
       <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            backgroundImage: 'linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
       }}></div>
    </div>
  );

  // 1. 待機/歡迎畫面
  if (systemState === 'IDLE' || systemState === 'STARTING') {
    return (
      <div style={styles.wrapper} className="bg-slate-900 text-cyan-400">
        {renderBackground()}
        
        <div style={{ zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', padding: '20px' }}>
           <div className="mb-8 relative">
              <Scan className={`w-24 h-24 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : 'animate-spin-slow'}`} />
           </div>
           
           <h1 className="text-4xl md:text-7xl font-bold tracking-widest mb-2 text-center" style={{fontFamily: 'Orbitron'}}>BIO-SCAN</h1>
           <p className="text-xs md:text-xl tracking-[0.3em] text-cyan-600 mb-12 text-center">生物特徵分析系統 V2.5</p>
           
           <div className="border border-cyan-500/50 bg-slate-900/80 p-6 rounded-lg backdrop-blur-sm max-w-md w-full text-center mb-8">
              <p className="text-xs text-slate-400 mb-2">SYSTEM STATUS</p>
              <p className={`text-lg text-emerald-400 animate-pulse`}>
                  {systemState === 'STARTING' ? loadingStatus : "READY"}
              </p>
              {debugMsg && <p className="text-xs text-yellow-500 mt-2 font-mono border-t border-slate-700 pt-2">{debugMsg}</p>}
           </div>

           {showForceEntry && (
               <button onClick={forceEntry} style={{...styles.button, borderColor: '#ef4444', color: '#ef4444', marginBottom: '1rem'}}>
                  <ShieldAlert className="w-6 h-6" /> FORCE ENTRY
               </button>
           )}

           {systemState === 'STARTING' ? (
              <button disabled style={{...styles.button, opacity: 0.7}}>
                 <Loader2 className="w-6 h-6 animate-spin" /> CONNECTING...
              </button>
           ) : (
             <button onClick={startScanning} style={styles.button}>
               <Fingerprint className="w-6 h-6" /> START ANALYSIS
             </button>
           )}
        </div>
      </div>
    );
  }

  // 2. 掃描與分析中畫面
  return (
    <div style={{...styles.wrapper, backgroundColor: 'black'}}>
      <video 
        ref={videoRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', opacity: 0.6 }} 
        playsInline 
        muted 
        autoPlay 
      />
      <canvas 
        ref={canvasRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 10 }}
        width={1280} 
        height={720} 
      />

      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 20, pointerEvents: 'none', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
         {/* Top Bar */}
         <div className="flex justify-between items-start w-full">
            <div className="flex flex-col gap-1">
               <div className="flex items-center gap-2 text-xs text-cyan-600">
                  <Activity className="w-4 h-4" />
                  <span>LIVE FEED // {debugMsg || 'ONLINE'}</span>
               </div>
               <h2 className="text-xl md:text-2xl font-bold tracking-widest border-l-4 border-cyan-500 pl-3">BIO-METRICS</h2>
            </div>
            <div className="text-right">
               <div className="text-2xl md:text-4xl font-bold" style={{fontFamily: 'Share Tech Mono'}}>
                  {new Date().toLocaleTimeString('en-US', {hour12: false})}
               </div>
            </div>
         </div>

         {/* Center Target */}
         {(systemState === 'SCANNING' || systemState === 'ANALYZING') && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-cyan-500/30 rounded-full flex items-center justify-center">
               <div className="absolute top-full mt-4 text-center w-full">
                  <p className="text-lg font-bold animate-pulse text-cyan-400">
                      {systemState === 'ANALYZING' ? 'PROCESSING DATA...' : 'SCANNING...'}
                  </p>
               </div>
            </div>
         )}

         {/* Bottom Data Panel */}
         {systemState === 'RESULT' ? (
            <div className="bg-slate-900/90 border border-cyan-500 p-6 backdrop-blur-md w-full max-w-4xl mx-auto rounded-lg pointer-events-auto" style={{pointerEvents: 'auto', marginBottom: '20px'}}>
               <div className="flex justify-between items-center mb-6 border-b border-cyan-800 pb-4">
                  <h3 className="text-xl md:text-3xl font-bold text-white flex items-center gap-3">
                     <Brain className="text-fuchsia-500" /> 分析報告 COMPLETE
                  </h3>
                  <button onClick={() => { setSystemState('SCANNING'); setScanProgress(0); }} className="px-4 py-2 border border-cyan-600 text-sm text-cyan-400 hover:bg-cyan-900 transition-colors flex items-center gap-2">
                     <RefreshCw className="w-4 h-4" /> RESCAN
                  </button>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-white">
                  <div className="space-y-2">
                     <div className="flex justify-between text-sm text-cyan-300">
                        <span>STRESS LEVEL</span>
                        <span>{metrics.stress}%</span>
                     </div>
                     <div className="h-4 bg-slate-800 rounded-full overflow-hidden w-full">
                        <div className={`h-full ${metrics.stress > 70 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{width: `${metrics.stress}%`}}></div>
                     </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded border-l-4 border-fuchsia-500">
                     <div>
                        <div className="text-xs text-fuchsia-300 mb-1">BIOLOGICAL AGE</div>
                     </div>
                     <div className="text-4xl md:text-5xl font-bold" style={{fontFamily: 'Orbitron'}}>
                        {metrics.age}<span className="text-lg text-fuchsia-500 ml-1">YR</span>
                     </div>
                  </div>
               </div>
            </div>
         ) : (
            <div className="w-full" style={{ marginBottom: '20px' }}>
               <div className="text-xs text-cyan-600">PROGRESS</div>
               <div className="h-2 bg-slate-800 mt-2 overflow-hidden w-full">
                  <div className="h-full bg-cyan-500" style={{width: `${scanProgress}%`}}></div>
               </div>
            </div>
         )}
      </div>
      
      <style>{`
        .animate-spin-slow { animation: spin 8s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}