import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Brain, RefreshCw, Fingerprint, Crosshair, Smile, User, Dna, Microscope } from 'lucide-react';

// BioFuture Scan - v6.1 動態校正修復版
// 1. [嚴重偏差修復] 移除 Hardcoded 畫布尺寸，改為讀取相機真實解析度 (Resolution Sync)
// 2. [邏輯優化] 在 checkVideoFrame 中強制同步 Canvas 與 Video 的寬高，確保座標完美對齊
// 3. [科學美學] 保持 v6.0 的黃金比例演算法

const MP_VERSION = '0.4.1633559619'; 

export default function BioFutureScanApp() {
  const [logs, setLogs] = useState([]); 
  const [videoKey, setVideoKey] = useState(0); 
  
  // UI 狀態
  const [systemState, setSystemState] = useState('IDLE'); 
  const [loadingStatus, setLoadingStatus] = useState("SYSTEM STANDBY");
  const [instruction, setInstruction] = useState("");
  
  // 核心數據
  const [metrics, setMetrics] = useState({
    deviationScore: 0, 
    age: 0, 
    gender: 'DETECTING...',
    symmetry: '0%',
    faceShape: 'ANALYZING'
  });
  
  const [scanProgress, setScanProgress] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  
  // 狀態鎖
  const stateRef = useRef('IDLE'); 

  const analysisBuffer = useRef({
    ratios: [],
    symmetries: [],
    smiles: []
  });

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 8));
  };

  useEffect(() => {
    stateRef.current = systemState;
  }, [systemState]);

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

    addLog("Correction Module Loaded.");
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
    setLoadingStatus("INITIALIZING OPTICS...");
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Error: Camera API not supported.");
      setSystemState('IDLE');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          // 不再強制指定尺寸，讓系統選擇最適合的，後續我們再讀取真實尺寸
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

  // [關鍵修復] 檢查畫面並同步 Canvas 尺寸
  const checkVideoFrame = () => {
      const checker = setInterval(() => {
          const video = videoRef.current;
          // 確保影片有寬高數據
          if (video && video.readyState >= 2 && video.currentTime > 0 && video.videoWidth > 0) {
              clearInterval(checker);
              
              // --- 解析度同步 (Resolution Sync) ---
              if (canvasRef.current) {
                  // 強制將 Canvas 的內部解析度設定為影片的真實解析度
                  // 這樣座標系統才會完全一致
                  canvasRef.current.width = video.videoWidth;
                  canvasRef.current.height = video.videoHeight;
                  addLog(`Calibrated: ${video.videoWidth}x${video.videoHeight}`);
              }
              
              addLog("Optical Sensors Active.");
              startScanningMode(); 
          }
      }, 100);
  };

  const startScanningMode = () => {
      analysisBuffer.current = { ratios: [], symmetries: [], smiles: [] };
      setSystemState('SCANNING_FACE');
      setInstruction("保持頭部靜止，掃描骨相結構...");
      setScanProgress(0);
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

  const calculateBiometrics = (landmarks) => {
      const faceHeight = Math.hypot(landmarks[10].x - landmarks[152].x, landmarks[10].y - landmarks[152].y);
      const faceWidth = Math.hypot(landmarks[234].x - landmarks[454].x, landmarks[234].y - landmarks[454].y);
      const ratio = faceHeight / faceWidth;
      const deviation = Math.abs(ratio - 1.618); 

      const leftDist = Math.hypot(landmarks[1].x - landmarks[234].x, landmarks[1].y - landmarks[234].y);
      const rightDist = Math.hypot(landmarks[1].x - landmarks[454].x, landmarks[1].y - landmarks[454].y);
      const symmetry = 1 - (Math.min(leftDist, rightDist) / Math.max(leftDist, rightDist)); 

      const mouthWidth = Math.hypot(landmarks[61].x - landmarks[291].x, landmarks[61].y - landmarks[291].y);
      const mouthHeight = Math.hypot(landmarks[13].x - landmarks[14].x, landmarks[13].y - landmarks[14].y);
      const smileRatio = mouthWidth / mouthHeight; 

      const jawWidth = Math.hypot(landmarks[58].x - landmarks[288].x, landmarks[58].y - landmarks[288].y);
      const jawRatio = jawWidth / faceWidth;
      const estimatedGender = jawRatio > 0.9 ? "MALE" : "FEMALE"; 

      return { deviation, symmetry, smileRatio, estimatedGender };
  };

  const finalizeScore = () => {
      const buffer = analysisBuffer.current;
      if (buffer.ratios.length === 0) return;

      const avgDeviation = buffer.ratios.reduce((a, b) => a + b, 0) / buffer.ratios.length;
      const avgSymmetry = buffer.symmetries.reduce((a, b) => a + b, 0) / buffer.symmetries.length;
      
      let rawScore = (avgDeviation * 15) + (avgSymmetry * 20);
      let finalScore = Math.min(9.9, Math.max(0.1, rawScore));
      
      const age = 20 + Math.floor(finalScore * 3) + Math.floor(Math.random() * 5);

      setMetrics({
          deviationScore: finalScore.toFixed(1),
          age: age,
          gender: buffer.genderLast || "NEUTRAL",
          symmetry: ((1 - avgSymmetry) * 100).toFixed(1) + "%",
          faceShape: avgDeviation < 0.1 ? "GOLDEN RATIO" : (avgDeviation > 0 ? "LONG" : "WIDE")
      });
  };

  const onResults = (results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    
    // [關鍵修復] 使用動態獲取的 Canvas 尺寸進行繪圖，而非固定的 1280x720
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    
    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        
        ctx.lineWidth = 1.5; // 線條粗細

        // 1. 眼眶 (Eyes)
        ctx.strokeStyle = '#06b6d4';
        const leftEye = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
        const rightEye = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382];
        
        ctx.beginPath();
        leftEye.forEach((idx, i) => {
            const x = landmarks[idx].x * width;
            const y = landmarks[idx].y * height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();

        ctx.beginPath();
        rightEye.forEach((idx, i) => {
            const x = landmarks[idx].x * width;
            const y = landmarks[idx].y * height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();

        // 2. 鼻樑與鼻型 (Nose)
        ctx.strokeStyle = '#3b82f6';
        const noseLine = [168, 6, 197, 195, 5, 4, 1, 19, 94];
        ctx.beginPath();
        noseLine.forEach((idx, i) => {
            const x = landmarks[idx].x * width;
            const y = landmarks[idx].y * height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // 3. 蘋果肌 (Cheeks)
        const leftCheek = landmarks[123];
        const rightCheek = landmarks[352];
        ctx.fillStyle = 'rgba(250, 204, 21, 0.4)';
        ctx.beginPath();
        ctx.arc(leftCheek.x * width, leftCheek.y * height, width * 0.015, 0, 2 * Math.PI); // 動態半徑
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rightCheek.x * width, rightCheek.y * height, width * 0.015, 0, 2 * Math.PI);
        ctx.fill();

        // 4. 唇線與嘴角 (Mouth)
        ctx.strokeStyle = '#ec4899';
        const lips = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 62, 76];
        ctx.beginPath();
        lips.forEach((idx, i) => {
            const x = landmarks[idx].x * width;
            const y = landmarks[idx].y * height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();

        // 畫出嘴角點
        ctx.fillStyle = '#ec4899';
        [61, 291].forEach(idx => {
            ctx.beginPath();
            ctx.arc(landmarks[idx].x * width, landmarks[idx].y * height, width * 0.003, 0, 2 * Math.PI);
            ctx.fill();
        });

        // --- 邏輯處理 ---
        const bio = calculateBiometrics(landmarks);

        // 階段 1: 掃描骨相 (5秒)
        if (stateRef.current === 'SCANNING_FACE') {
            analysisBuffer.current.ratios.push(bio.deviation);
            analysisBuffer.current.symmetries.push(bio.symmetry);
            analysisBuffer.current.genderLast = bio.estimatedGender;

            setScanProgress(prev => {
                const next = prev + 0.8;
                if (next >= 100) {
                    setSystemState('WAITING_SMILE');
                    setInstruction("檢測到骨相數據。請展露笑容...");
                    return 0;
                }
                return next;
            });
        }

        // 階段 2: 笑容檢測
        if (stateRef.current === 'WAITING_SMILE') {
            setScanProgress(prev => {
                const next = prev + 1.5;
                if (next >= 100) {
                    setSystemState('ANALYZING');
                    setInstruction("正在生成科學評測報告...");
                    setTimeout(() => {
                        finalizeScore();
                        setSystemState('RESULT');
                    }, 1500);
                    return 100;
                }
                return next;
            });
        }
      }
    }
    ctx.restore();
  };

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
      {/* 1. 核心層：Canvas 和 Video */}
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
      {/* 移除 Hardcoded width/height，由程式動態設定 */}
      <canvas 
        ref={canvasRef} 
        style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
            objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 2 
        }} 
      />

      {/* 2. 待機畫面 */}
      {(systemState === 'IDLE' || systemState === 'STARTING') && (
        <div style={styles.overlay}>
           <div style={{marginBottom: '2rem', display: 'flex', justifyContent: 'center'}}>
              <Microscope className={`w-24 h-24 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : ''}`} />
           </div>
           <h1 className="text-4xl font-bold tracking-widest mb-2 text-center">AESTHETICS BIO-METRIC</h1>
           <p className="text-sm tracking-widest text-cyan-600 mb-8">科學美學分析系統 v6.1</p>
           
           {systemState === 'STARTING' ? (
               <div className="text-emerald-400 animate-pulse text-xl">{loadingStatus}</div>
           ) : (
               <button onClick={startCameraSequence} style={styles.btn}>
                   <Crosshair /> START ANALYSIS
               </button>
           )}
        </div>
      )}

      {/* 3. 掃描中 & 指令 (頂部 HUD) */}
      {(systemState === 'SCANNING_FACE' || systemState === 'WAITING_SMILE' || systemState === 'ANALYZING' || systemState === 'RESULT') && (
        <div className="absolute top-0 left-0 w-full z-20 pointer-events-none p-4 pt-8 md:pt-12">
           <div className="bg-slate-900/80 backdrop-blur-md border-b-2 border-cyan-500 p-4 rounded-b-2xl shadow-[0_0_30px_rgba(6,182,212,0.3)] flex flex-col items-center">
               
               {systemState === 'RESULT' ? (
                   // 結果顯示
                   <div className="w-full flex flex-col items-center animate-fade-in-down">
                       <div className="flex items-center gap-2 text-yellow-400 mb-2">
                           <Brain className="w-5 h-5" />
                           <span className="tracking-widest font-bold">ANALYSIS REPORT</span>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-8 w-full max-w-md text-center mb-4">
                           <div>
                               <div className="text-xs text-slate-400">BIOLOGICAL AGE</div>
                               <div className="text-3xl font-bold text-white font-mono">{metrics.age}</div>
                           </div>
                           <div>
                               <div className="text-xs text-slate-400">GENDER ESTIMATE</div>
                               <div className="text-3xl font-bold text-white font-mono">{metrics.gender}</div>
                           </div>
                       </div>

                       <div className="flex flex-col items-center border-t border-slate-700 w-full pt-4">
                           <span className="text-sm text-cyan-400 mb-1">外貌偏差指數 (DEVIATION SCORE)</span>
                           <div className="flex items-baseline gap-2">
                               <span className="text-6xl font-bold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" style={{fontFamily: 'Orbitron'}}>
                                   {metrics.deviationScore}
                               </span>
                               <span className="text-xs text-slate-500">/ 10</span>
                           </div>
                           <span className="text-[10px] text-slate-500 mt-1">0 = MATHEMATICALLY PERFECT (GOLDEN RATIO)</span>
                       </div>

                       <div className="mt-6 pointer-events-auto">
                           <button 
                               onClick={startScanningMode}
                               className="flex items-center gap-2 px-6 py-2 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500 text-cyan-300 rounded-full transition-all text-sm"
                           >
                               <RefreshCw className="w-4 h-4" /> NEW SCAN
                           </button>
                       </div>
                   </div>
               ) : (
                   // 掃描過程
                   <div className="flex flex-col items-center w-full">
                       <div className="flex items-center gap-2 text-cyan-400 mb-1">
                           {systemState === 'WAITING_SMILE' ? <Smile className="w-6 h-6 animate-bounce" /> : <Scan className="w-6 h-6 animate-pulse" />}
                           <span className="text-lg font-bold tracking-widest text-center">{instruction}</span>
                       </div>
                       <div className="w-full max-w-xs h-1 bg-slate-700 mt-2 rounded-full overflow-hidden">
                           <div className="h-full bg-cyan-500 transition-all duration-75" style={{width: `${scanProgress}%`}}></div>
                       </div>
                   </div>
               )}
           </div>
        </div>
      )}

      {renderLogWindow()}
    </div>
  );
}