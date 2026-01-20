import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Brain, RefreshCw, Fingerprint, ShieldAlert, Bug, Terminal } from 'lucide-react';

// BioFuture Scan - v3.1 結構重組修復版
// 1. [修復 Fatal Error] 將 Video 元件移至最外層，確保在任何狀態下都存在 (解決 Ref is null)
// 2. [優化] 使用 opacity 控制 Video 顯示/隱藏，而非條件渲染
// 3. [保留] v3.0 的詳細 Debug Log 功能

const MP_VERSION = '0.4.1633559619'; 

export default function BioFutureScanApp() {
  const [logs, setLogs] = useState([]); 
  const [videoKey, setVideoKey] = useState(0); 
  
  // UI 狀態
  const [systemState, setSystemState] = useState('IDLE'); 
  const [loadingStatus, setLoadingStatus] = useState("SYSTEM STANDBY");
  
  const [metrics, setMetrics] = useState({ stress: 0, age: 0 });
  const [scanProgress, setScanProgress] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);
  const streamRef = useRef(null);

  // --- 輔助：寫入日誌 ---
  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10));
    console.log(`[BioScan] ${msg}`);
  };

  // --- 1. 初始化 ---
  useEffect(() => {
    document.body.style.backgroundColor = '#0f172a';
    document.body.style.margin = '0';
    
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

    addLog("System Booted. Video Element Ready.");
    
    // 預載入 AI
    initAI();

    return () => {
        stopCamera(); 
    };
  }, []);

  const initAI = async () => {
    addLog("Pre-loading AI Core...");
    try {
      const script = document.createElement('script');
      script.src = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}/face_mesh.js`;
      script.async = true;
      document.body.appendChild(script);
    } catch (e) {
      addLog("AI Pre-load Error: " + e.message);
    }
  };

  // --- 2. 核心相機邏輯 ---
  const startCameraSequence = async () => {
    // 這裡不使用 setVideoKey，因為我們要保留現有的 Video 元件實例
    setSystemState('STARTING');
    setLoadingStatus("INITIALIZING HARDWARE...");
    addLog("=== STARTING SEQUENCE ===");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Error: Camera API not supported.");
      addLog("Fatal: getUserMedia not found");
      setSystemState('IDLE');
      return;
    }

    try {
      addLog("1. Requesting User Permission...");
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      streamRef.current = stream;
      addLog("2. Stream Acquired. ID: " + stream.id);

      // 關鍵檢查：此時 Video Ref 必須存在
      if (videoRef.current) {
        addLog("3. Attaching to Video Element...");
        const video = videoRef.current;
        
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        
        addLog("4. Executing iOS Play Sequence...");
        
        // 給予一點緩衝讓 DOM 更新屬性
        await new Promise(r => setTimeout(r, 100));
        
        try {
            await video.play();
            addLog("5. Play() Promise Resolved!");
        } catch(playError) {
            addLog("Warning: Play() blocked: " + playError.message);
            // 靜音重試
            video.muted = true;
            await video.play();
            addLog("5b. Retry Play() executed.");
        }

        checkVideoFrame();
        initFaceMesh();

      } else {
        // 如果這裡還是 null，代表 DOM 結構有嚴重問題
        addLog("Fatal Error: Video Ref is STILL null!");
        alert("系統錯誤：視訊元件未載入，請重新整理網頁。");
        setSystemState('IDLE');
      }

    } catch (err) {
      addLog("Error: " + err.name + " - " + err.message);
      alert("無法啟動相機: " + err.message);
      setSystemState('IDLE');
    }
  };

  const checkVideoFrame = () => {
      addLog("6. Verifying Video Data...");
      let attempts = 0;
      const checker = setInterval(() => {
          attempts++;
          const video = videoRef.current;
          
          if (video && video.readyState >= 2 && video.currentTime > 0) {
              clearInterval(checker);
              addLog(">>> SUCCESS: Video is flowing! <<<");
              setSystemState('SCANNING'); // 轉場
          } else {
              if (attempts % 10 === 0) addLog(`Waiting... State: ${video?.readyState}, Time: ${video?.currentTime}`);
              if (attempts > 50) { 
                  clearInterval(checker);
                  addLog("Error: Video stuck (Black Screen)");
                  alert("畫面讀取逾時。請按重新整理。");
              }
          }
      }, 100);
  };

  const stopCamera = () => {
      if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
      }
      isLooping.current = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  // --- 3. AI 邏輯 ---
  const initFaceMesh = async () => {
      addLog("7. Waking up AI Brain...");
      
      let retries = 0;
      while (!window.FaceMesh && retries < 20) {
          await new Promise(r => setTimeout(r, 500));
          retries++;
      }

      if (!window.FaceMesh) {
          addLog("AI Warning: Library not loaded.");
          return;
      }

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
          addLog("8. AI Pipeline Connected.");
          processFrame();
      } catch(e) {
          addLog("AI Init Error: " + e.message);
      }
  };

  const processFrame = async () => {
    if (!isLooping.current) return;
    if (videoRef.current && faceMeshRef.current && !videoRef.current.paused) {
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
        ctx.fillStyle = '#06b6d4'; 
        for (let i = 0; i < landmarks.length; i+=10) { 
            const x = landmarks[i].x * width;
            const y = landmarks[i].y * height;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        setScanProgress(p => p >= 100 ? 100 : p + 0.5);
        if (Math.random() > 0.9) {
            setMetrics({
                stress: Math.floor(Math.random() * 40) + 20,
                age: Math.floor(Math.random() * 10) + 25
            });
        }
      }
    }
    ctx.restore();
  };

  useEffect(() => {
      if (scanProgress >= 100 && systemState === 'SCANNING') {
          setSystemState('RESULT');
      }
  }, [scanProgress]);


  // --- UI ---
  const renderLogWindow = () => (
      <div className="absolute bottom-0 left-0 w-full bg-black/90 text-green-400 font-mono text-[10px] p-2 max-h-32 overflow-y-auto z-50 border-t border-green-800 opacity-80 pointer-events-none">
          <div className="flex items-center gap-2 border-b border-green-900 mb-1 pb-1">
              <Terminal className="w-3 h-3" /> DEBUG CONSOLE
          </div>
          {logs.map((log, i) => (
              <div key={i}>{log}</div>
          ))}
      </div>
  );

  const styles = {
    wrapper: {
        backgroundColor: '#0f172a', color: '#22d3ee', minHeight: '100vh', width: '100vw', maxWidth: '100%', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: '"Orbitron", monospace',
        position: 'relative'
    },
    // 待機畫面覆蓋層
    overlay: {
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.9)' // 半透明背景，隱約看到後面 Video
    },
    btn: {
        padding: '1rem 2rem', border: '2px solid #06b6d4', color: '#22d3ee', fontSize: '1.2rem', marginTop: '20px',
        display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', background: 'rgba(6,182,212,0.1)'
    }
  };

  return (
    <div style={styles.wrapper}>
      {/* 1. 核心層：Video & Canvas (永遠存在) */}
      <video 
        key={videoKey}
        ref={videoRef} 
        style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
            objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 1 
        }} 
        playsInline 
        muted 
        autoPlay
      />
      <canvas 
        ref={canvasRef} 
        width={1280} height={720}
        style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
            objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 2 
        }} 
      />

      {/* 2. 介面層：待機畫面 (覆蓋在 Video 上) */}
      {(systemState === 'IDLE' || systemState === 'STARTING') && (
        <div style={styles.overlay}>
           <div style={{marginBottom: '2rem', display: 'flex', justifyContent: 'center'}}>
              <Scan className={`w-20 h-20 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : ''}`} />
           </div>
           <h1 className="text-4xl font-bold tracking-widest mb-2">BIO-SCAN</h1>
           <p className="text-xs tracking-widest text-cyan-600 mb-8">V3.1 STABLE CORE</p>
           
           {systemState === 'STARTING' ? (
               <div className="text-emerald-400 animate-pulse">{loadingStatus}</div>
           ) : (
               <button onClick={startCameraSequence} style={styles.btn}>
                   <Fingerprint /> START SYSTEM
               </button>
           )}
        </div>
      )}

      {/* 3. 介面層：掃描 HUD */}
      {(systemState === 'SCANNING' || systemState === 'RESULT') && (
        <div style={{ zIndex: 20, position: 'absolute', top: 0, left: 0, width: '100%', padding: '20px', pointerEvents: 'none' }}>
           <div className="flex items-center gap-2 text-xs text-cyan-400">
               <Activity className="w-4 h-4" /> LIVE FEED
           </div>
           <h2 className="text-xl font-bold border-l-4 border-cyan-500 pl-2">BIO-METRICS</h2>
        </div>
      )}

      {/* 4. 介面層：結果報告 */}
      {systemState === 'RESULT' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900/90 border border-cyan-500 p-6 rounded-lg w-11/12 max-w-md z-30 pointer-events-auto">
              <div className="flex items-center gap-2 mb-4 text-white text-xl font-bold">
                  <Brain className="text-fuchsia-500" /> ANALYSIS REPORT
              </div>
              <div className="space-y-4">
                  <div className="flex justify-between text-cyan-300">
                      <span>STRESS</span>
                      <span>{metrics.stress}%</span>
                  </div>
                  <div className="flex justify-between text-white text-2xl font-bold border-l-4 border-fuchsia-500 pl-4 bg-slate-800/50 p-2">
                      <span>BIO AGE</span>
                      <span>{metrics.age} YR</span>
                  </div>
                  <button onClick={() => {setScanProgress(0); setSystemState('SCANNING');}} className="w-full border border-cyan-500 py-2 mt-4 text-cyan-400 hover:bg-cyan-900">
                      RESCAN
                  </button>
              </div>
          </div>
      )}

      {renderLogWindow()}
    </div>
  );
}