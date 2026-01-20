import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Brain, RefreshCw, Fingerprint, Terminal, HeartPulse, Clock, Dna } from 'lucide-react';

// BioFuture Scan - v5.0 生物特徵運算版
// 1. [核心升級] 移除隨機數，改用基於 FaceMesh 特徵點的確定性演算法
// 2. [科學指標] 綜合計算：臉部對稱性、情緒(微笑)、壓力(皺眉)、黃金比例
// 3. [視覺優化] 保持頂部 HUD 設計，掃描過程顯示數據運算感

const MP_VERSION = '0.4.1633559619'; 

export default function BioFutureScanApp() {
  const [logs, setLogs] = useState([]); 
  const [videoKey, setVideoKey] = useState(0); 
  
  // UI 狀態
  const [systemState, setSystemState] = useState('IDLE'); 
  const [loadingStatus, setLoadingStatus] = useState("SYSTEM STANDBY");
  
  // 核心數據
  const [lifespan, setLifespan] = useState(0); 
  const [scanProgress, setScanProgress] = useState(0);
  // 新增：顯示詳細分析因子 (Debug用或展示用)
  const [analysisFactors, setAnalysisFactors] = useState({ symmetry: 0, vitality: 0 });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  
  const isScanningRef = useRef(false);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10));
  };

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

    addLog("Bio-Algorithm Loaded.");
    initAI();

    return () => stopCamera(); 
  }, []);

  const initAI = async () => {
    try {
      const script = document.createElement('script');
      script.src = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}/face_mesh.js`;
      script.async = true;
      document.body.appendChild(script);
    } catch (e) {
      addLog("AI Error: " + e.message);
    }
  };

  const startCameraSequence = async () => {
    setSystemState('STARTING');
    setLoadingStatus("INITIALIZING...");
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Error: Camera API not supported.");
      setSystemState('IDLE');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      streamRef.current = stream;

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        
        await new Promise(r => setTimeout(r, 100));
        
        try {
            await video.play();
        } catch(playError) {
            video.muted = true;
            await video.play();
        }

        checkVideoFrame();
        initFaceMesh();
      } else {
        alert("系統錯誤：視訊元件未載入，請重新整理網頁。");
        setSystemState('IDLE');
      }
    } catch (err) {
      alert("無法啟動相機: " + err.message);
      setSystemState('IDLE');
    }
  };

  const checkVideoFrame = () => {
      const checker = setInterval(() => {
          const video = videoRef.current;
          if (video && video.readyState >= 2 && video.currentTime > 0) {
              clearInterval(checker);
              addLog("Optical Sensors Active.");
              startScanningMode(); 
          }
      }, 100);
  };

  const startScanningMode = () => {
      setSystemState('SCANNING');
      setScanProgress(0);
      isScanningRef.current = true; 
  };

  const stopCamera = () => {
      if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
      }
      isLooping.current = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const initFaceMesh = async () => {
      let retries = 0;
      while (!window.FaceMesh && retries < 20) {
          await new Promise(r => setTimeout(r, 500));
          retries++;
      }

      if (!window.FaceMesh) return;

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
          processFrame();
      } catch(e) {
          addLog("AI Error: " + e.message);
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

  // --- 🧬 科學化壽命演算法 (Biometric Algorithm) ---
  const calculateScientificLifespan = (landmarks) => {
      // 1. 對稱性分析 (Symmetry Analysis)
      // 取左右臉頰(234, 454)到鼻尖(1)的水平距離差異
      const noseX = landmarks[1].x;
      const leftCheekDist = Math.abs(landmarks[234].x - noseX);
      const rightCheekDist = Math.abs(landmarks[454].x - noseX);
      // 對稱係數 (0.0 ~ 1.0)，越接近 1 越對稱
      const symmetry = Math.min(leftCheekDist, rightCheekDist) / Math.max(leftCheekDist, rightCheekDist);
      
      // 2. 壓力/皺眉指數 (Stress Marker)
      // 眉頭間距 (107, 336)，正規化為臉寬的比例
      const faceWidth = Math.abs(landmarks[234].x - landmarks[454].x);
      const browDist = Math.abs(landmarks[107].x - landmarks[336].x);
      const browRatio = browDist / faceWidth; 
      // 一般放鬆時比例約 0.25，緊皺小於 0.15。比例越大(越放鬆)越好。
      const stressScore = Math.min(1.0, Math.max(0, (browRatio - 0.15) * 5)); // 0.0 ~ 1.0

      // 3. 情緒韌性/微笑指數 (Emotional Resilience)
      // 嘴角(61, 291) 高度相對於人中(0)
      const mouthY = (landmarks[61].y + landmarks[291].y) / 2;
      const philtrumY = landmarks[0].y;
      // 微笑時嘴角會上揚 (y值變小)，接近或高於人中
      const smileLift = philtrumY - mouthY; 
      // 微笑加分：有微笑給予額外壽命加成
      const smileBonus = smileLift > -0.02 ? 5 : 0;

      // 4. 黃金比例 (Golden Ratio)
      const faceHeight = Math.abs(landmarks[10].y - landmarks[152].y);
      const hwRatio = faceHeight / faceWidth;
      const goldenDiff = Math.abs(hwRatio - 1.618);
      const structureScore = Math.max(0, 1 - goldenDiff); // 越接近 1.618 分數越高

      // --- 綜合計算公式 ---
      // 基礎壽命: 75歲
      let predictedAge = 75;
      
      // 因子加權
      predictedAge += symmetry * 8;       // 對稱性最多 +8 歲
      predictedAge += stressScore * 10;   // 放鬆無壓力最多 +10 歲
      predictedAge += structureScore * 5; // 結構優良最多 +5 歲
      predictedAge += smileBonus;         // 微笑直接 +5 歲

      // 確保數值在合理範圍 (75 ~ 105)
      return Math.floor(Math.max(75, Math.min(105, predictedAge)));
  };

  const onResults = (results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { width, height } = canvasRef.current;
    
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    
    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        // 繪製科技感網格
        ctx.fillStyle = '#06b6d4'; 
        // 繪製關鍵特徵點 (眉毛、眼睛、嘴巴周圍)
        const keyPoints = [107, 336, 61, 291, 1, 234, 454, 10, 152]; 
        
        // 畫出所有點的淡淡背景
        for (let i = 0; i < landmarks.length; i+=15) { 
            const x = landmarks[i].x * width;
            const y = landmarks[i].y * height;
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
            ctx.fill();
        }

        // 特別標註運算點 (紅色/黃色)
        keyPoints.forEach(idx => {
            const x = landmarks[idx].x * width;
            const y = landmarks[idx].y * height;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(250, 204, 21, 0.8)'; // Yellow
            ctx.fill();
        });
        
        // --- 核心掃描邏輯 ---
        if (isScanningRef.current) {
            setScanProgress(prev => {
                const nextProgress = prev + 0.5; // 約 6 秒完成
                
                if (nextProgress >= 100) {
                    isScanningRef.current = false; 
                    setSystemState('RESULT');
                    
                    // [關鍵修改] 使用科學演算法計算最終數值
                    const finalAge = calculateScientificLifespan(landmarks);
                    setLifespan(finalAge);
                    
                    return 100;
                }
                
                // 掃描中：數字快速跳動 (模擬高速運算)
                const tempAge = 70 + Math.floor(Math.random() * 40);
                setLifespan(tempAge);
                
                return nextProgress;
            });
        }
      }
    }
    ctx.restore();
  };

  // --- UI ---
  const renderLogWindow = () => (
      <div className="absolute bottom-0 left-0 w-full bg-black/90 text-green-400 font-mono text-[10px] p-2 max-h-24 overflow-y-auto z-50 border-t border-green-800 opacity-60 pointer-events-none">
          {logs.map((log, i) => <div key={i}>{log}</div>)}
      </div>
  );

  const styles = {
    wrapper: {
        backgroundColor: '#0f172a', color: '#22d3ee', minHeight: '100vh', width: '100vw', maxWidth: '100%', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: '"Orbitron", monospace',
        position: 'relative'
    },
    overlay: {
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.95)'
    },
    btn: {
        padding: '1rem 2rem', border: '2px solid #06b6d4', color: '#22d3ee', fontSize: '1.2rem', marginTop: '20px',
        display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', background: 'rgba(6,182,212,0.1)'
    }
  };

  return (
    <div style={styles.wrapper}>
      {/* 1. 核心層 */}
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

      {/* 2. 待機畫面 */}
      {(systemState === 'IDLE' || systemState === 'STARTING') && (
        <div style={styles.overlay}>
           <div style={{marginBottom: '2rem', display: 'flex', justifyContent: 'center'}}>
              <Dna className={`w-24 h-24 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : ''}`} />
           </div>
           <h1 className="text-5xl font-bold tracking-widest mb-2">BIO-SCAN</h1>
           <p className="text-sm tracking-widest text-cyan-600 mb-8">AI 預測系統 v5.0</p>
           
           {systemState === 'STARTING' ? (
               <div className="text-emerald-400 animate-pulse text-xl">{loadingStatus}</div>
           ) : (
               <button onClick={startCameraSequence} style={styles.btn}>
                   <Fingerprint /> START ANALYSIS
               </button>
           )}
        </div>
      )}

      {/* 3. 掃描中 & 結果展示 (頂部 HUD) */}
      {(systemState === 'SCANNING' || systemState === 'RESULT') && (
        <div className="absolute top-0 left-0 w-full z-20 pointer-events-none p-4 pt-8 md:pt-12">
           {/* 半透明背景條 */}
           <div className="bg-slate-900/80 backdrop-blur-md border-b-2 border-cyan-500 p-4 rounded-b-2xl shadow-[0_0_30px_rgba(6,182,212,0.3)] flex flex-col items-center">
               
               {/* 標題 */}
               <div className="flex items-center gap-2 text-cyan-400 mb-1">
                   {systemState === 'SCANNING' ? (
                       <Activity className="w-5 h-5 animate-pulse" />
                   ) : (
                       <Brain className="w-5 h-5 text-yellow-400" />
                   )}
                   <span className="tracking-[0.2em] text-sm">
                       {systemState === 'SCANNING' ? "CALCULATING BIOMETRICS..." : "PREDICTION COMPLETE"}
                   </span>
               </div>

               {/* 主數字顯示區 */}
               <div className="flex items-baseline gap-2">
                   <span className="text-lg text-slate-400">預測壽命</span>
                   <span 
                       className={`text-6xl font-bold ${systemState === 'RESULT' ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]' : 'text-cyan-400'}`} 
                       style={{fontFamily: 'Orbitron'}}
                   >
                       {lifespan}
                   </span>
                   <span className="text-xl text-slate-400">歲</span>
               </div>

               {/* 掃描進度條 */}
               {systemState === 'SCANNING' && (
                   <div className="w-64 h-1 bg-slate-700 mt-3 rounded-full overflow-hidden">
                       <div className="h-full bg-cyan-500 transition-all duration-75" style={{width: `${scanProgress}%`}}></div>
                   </div>
               )}

               {/* 重新掃描按鈕 (僅結果頁出現) */}
               {systemState === 'RESULT' && (
                   <div className="mt-4 pointer-events-auto flex flex-col items-center gap-2">
                       <div className="text-[10px] text-cyan-600 font-mono">
                          BASED ON SYMMETRY, STRESS & VITALITY MARKERS
                       </div>
                       <button 
                           onClick={startScanningMode}
                           className="flex items-center gap-2 px-6 py-2 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500 text-cyan-300 rounded-full transition-all text-sm"
                       >
                           <RefreshCw className="w-4 h-4" /> 重新測量
                       </button>
                   </div>
               )}
           </div>
        </div>
      )}

      {renderLogWindow()}
    </div>
  );
}