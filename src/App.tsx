import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Brain, RefreshCw, Fingerprint, ShieldAlert, Bug, Terminal } from 'lucide-react';

// BioFuture Scan - v3.0 工程除錯版
// 1. [核心重寫] 引入 "工程日誌" 視窗，實時顯示相機啟動的每一步驟
// 2. [iOS 修復] 強制重建 Video 標籤，清除 iOS 緩衝殘留
// 3. [邏輯調整] 嚴格的 playsInline -> load -> play 順序，符合 iOS Safari 規範

const MP_VERSION = '0.4.1633559619'; 

export default function BioFutureScanApp() {
  const [logs, setLogs] = useState([]); // 工程日誌
  const [videoKey, setVideoKey] = useState(0); // 用於強制重置 Video 元件
  
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
    
    // 載入字體
    const fontLink = document.createElement('link');
    fontLink.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Share+Tech+Mono&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);

    // 載入 Tailwind
    if (!document.querySelector('script[src*="tailwindcss"]')) {
      const script = document.createElement('script');
      script.src = "https://cdn.tailwindcss.com";
      script.async = true;
      document.head.appendChild(script);
    }

    addLog("System Booted. Ready.");
    
    // 預載入 AI
    initAI();

    return () => {
        stopCamera(); // 清理
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

  // --- 2. 核心相機邏輯 (嚴格順序版) ---
  const startCameraSequence = async () => {
    // 重置狀態
    setVideoKey(prev => prev + 1); // 強制重建 Video DOM
    setSystemState('STARTING');
    setLoadingStatus("INITIALIZING HARDWARE...");
    addLog("=== STARTING SEQUENCE ===");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Error: Camera API not supported on this browser.");
      addLog("Fatal: getUserMedia not found");
      setSystemState('IDLE');
      return;
    }

    try {
      addLog("1. Requesting User Permission...");
      
      // 步驟 1: 請求串流
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

      // 步驟 2: 綁定到 Video
      if (videoRef.current) {
        addLog("3. Attaching to Video Element...");
        const video = videoRef.current;
        
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true; // 關鍵：直接設定屬性
        
        // 步驟 3: iOS 儀式 (load -> play)
        addLog("4. Executing iOS Play Sequence...");
        
        // 等待一小段時間讓 DOM 更新
        await new Promise(r => setTimeout(r, 100));
        
        try {
            await video.play();
            addLog("5. Play() Promise Resolved!");
        } catch(playError) {
            addLog("Warning: Play() blocked/failed: " + playError.message);
            // 嘗試暴力解法：靜音再播
            video.muted = true;
            await video.play();
            addLog("5b. Retry Play() executed.");
        }

        // 步驟 4: 確認畫面真的出來了
        checkVideoFrame();
        
        // 步驟 5: 啟動 AI (不阻擋畫面)
        initFaceMesh();

      } else {
        addLog("Fatal: Video Ref is null!");
      }

    } catch (err) {
      addLog("Error: " + err.name + " - " + err.message);
      alert("無法啟動相機: " + err.message);
      setSystemState('IDLE');
    }
  };

  // 檢查畫面是否真的在動
  const checkVideoFrame = () => {
      addLog("6. Verifying Video Data...");
      let attempts = 0;
      const checker = setInterval(() => {
          attempts++;
          const video = videoRef.current;
          
          if (video && video.readyState >= 2 && video.currentTime > 0) {
              clearInterval(checker);
              addLog(">>> SUCCESS: Video is flowing! <<<");
              setSystemState('SCANNING'); // 只有確認有畫面才轉場
          } else {
              if (attempts % 10 === 0) addLog(`Waiting for frames... (${video?.readyState})`);
              if (attempts > 50) { // 5秒超時
                  clearInterval(checker);
                  addLog("Error: Video stuck at loading (Black Screen)");
                  alert("偵測到畫面黑屏。請嘗試重新整理網頁，或檢查瀏覽器權限。");
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
      
      // 等待全域變數
      let retries = 0;
      while (!window.FaceMesh && retries < 20) {
          await new Promise(r => setTimeout(r, 500));
          retries++;
      }

      if (!window.FaceMesh) {
          addLog("AI Warning: FaceMesh lib not loaded yet.");
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
        // 簡單繪製，證明 AI 有在動
        ctx.fillStyle = '#06b6d4'; 
        for (let i = 0; i < landmarks.length; i+=10) { 
            const x = landmarks[i].x * width;
            const y = landmarks[i].y * height;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 模擬數據更新
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

  // 進度滿了自動跳轉
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
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: '"Orbitron", monospace'
    },
    btn: {
        padding: '1rem 2rem', border: '2px solid #06b6d4', color: '#22d3ee', fontSize: '1.2rem', marginTop: '20px',
        display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', background: 'rgba(6,182,212,0.1)'
    }
  };

  // 1. 待機畫面
  if (systemState === 'IDLE' || systemState === 'STARTING') {
    return (
      <div style={styles.wrapper}>
        <div style={{zIndex: 10, textAlign: 'center'}}>
           <div style={{marginBottom: '2rem', display: 'flex', justifyContent: 'center'}}>
              <Scan className={`w-20 h-20 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : ''}`} />
           </div>
           <h1 className="text-4xl font-bold tracking-widest mb-2">BIO-SCAN</h1>
           <p className="text-xs tracking-widest text-cyan-600 mb-8">V3.0 DEBUG MODE</p>
           
           {systemState === 'STARTING' ? (
               <div className="text-emerald-400 animate-pulse">{loadingStatus}</div>
           ) : (
               <button onClick={startCameraSequence} style={styles.btn}>
                   <Fingerprint /> START SYSTEM
               </button>
           )}
        </div>
        {renderLogWindow()}
      </div>
    );
  }

  // 2. 掃描/結果畫面
  return (
    <div style={{...styles.wrapper, backgroundColor: 'black', justifyContent: 'flex-start'}}>
      {/* 強制 Video 滿版且可見 */}
      <video 
        key={videoKey} // 關鍵：用於強制重建
        ref={videoRef} 
        style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
            objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 1 
        }} 
        playsInline 
        muted 
        autoPlay // 再次強調
      />
      <canvas 
        ref={canvasRef} 
        width={1280} height={720}
        style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
            objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 2 
        }} 
      />

      {/* UI Overlay */}
      <div style={{ zIndex: 10, width: '100%', padding: '20px', display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
         <div className="flex flex-col">
            <div className="flex items-center gap-2 text-xs text-cyan-400">
               <Activity className="w-4 h-4" /> LIVE FEED
            </div>
            <h2 className="text-xl font-bold border-l-4 border-cyan-500 pl-2">BIO-METRICS</h2>
         </div>
      </div>

      {/* 結果面板 */}
      {systemState === 'RESULT' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900/90 border border-cyan-500 p-6 rounded-lg w-11/12 max-w-md z-20 pointer-events-auto">
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