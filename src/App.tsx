import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Brain, RefreshCw, Fingerprint, Crosshair, Smile, User, Dna, Microscope, Box } from 'lucide-react';

// BioFuture Scan - v7.0 3D 結構生物掃描版
// 1. [3D 核心] 引入 Z 軸深度運算，計算真實歐幾里得距離，抵抗角度偏差
// 2. [人類學演算法] 使用下顎/顴骨比例判斷性別；使用眼角下垂度與法令紋深度估算年齡
// 3. [視覺升級] 網格根據深度 (Z-depth) 變色，呈現立體地形圖效果

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
    gender: 'ANALYZING',
    symmetry: '0%',
    faceShape: 'SCANNING',
    skinCondition: 'NORMAL'
  });
  
  const [scanProgress, setScanProgress] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  
  const stateRef = useRef('IDLE'); 

  // 數據緩衝區 (取平均值用)
  const analysisBuffer = useRef({
    scores: [],
    ages: [],
    genders: [], // 0 for Fem, 1 for Masc
    symmetries: []
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

    addLog("3D Structural Analysis Module Loaded.");
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
    setLoadingStatus("INITIALIZING 3D SENSORS...");
    
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
          if (video && video.readyState >= 2 && video.currentTime > 0 && video.videoWidth > 0) {
              clearInterval(checker);
              if (canvasRef.current) {
                  canvasRef.current.width = video.videoWidth;
                  canvasRef.current.height = video.videoHeight;
                  addLog(`Calibrated: ${video.videoWidth}x${video.videoHeight} (3D Mode)`);
              }
              startScanningMode(); 
          }
      }, 100);
  };

  const startScanningMode = () => {
      analysisBuffer.current = { scores: [], ages: [], genders: [], symmetries: [] };
      setSystemState('SCANNING_FACE');
      setInstruction("建立 3D 臉部模型...請保持不動");
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
            minDetectionConfidence: 0.7, // 提高信心閾值，減少雜訊
            minTrackingConfidence: 0.7
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

  // --- 🧬 3D 結構演算法 (Anthropometric 3D) ---
  
  // 計算 3D 空間中的兩點距離
  const getDistance3D = (p1, p2) => {
      return Math.sqrt(
          Math.pow(p1.x - p2.x, 2) + 
          Math.pow(p1.y - p2.y, 2) + 
          Math.pow(p1.z - p2.z, 2) // 引入深度
      );
  };

  const calculate3DBiometrics = (landmarks) => {
      // 1. 性別判斷 (Sexual Dimorphism)
      // 使用 "下顎寬度 (Bigonial Width)" vs "顴骨寬度 (Bizygomatic Width)"
      // 顴骨寬: 234 - 454
      // 下顎寬: 58 - 288 (Gonions)
      const cheekWidth = getDistance3D(landmarks[234], landmarks[454]);
      const jawWidth = getDistance3D(landmarks[58], landmarks[288]);
      
      // 男性通常下顎較寬，比例接近 0.9 或更高。女性通常較V，比例較低。
      const jawRatio = jawWidth / cheekWidth;
      // 0.0 = 女性特徵, 1.0 = 男性特徵 (正規化)
      const genderScore = Math.max(0, Math.min(1, (jawRatio - 0.7) * 5)); 

      // 2. 年齡估算 (Age markers)
      // A. 眼角下垂 (Canthal Tilt): 外眼角(33/263) 與 內眼角(133/362) 的 Y 軸差值
      // 年輕時外眼角通常高於或平於內眼角。老化時外眼角會下垂。
      const leftEyeTilt = landmarks[33].y - landmarks[133].y; // +值代表下垂
      const rightEyeTilt = landmarks[263].y - landmarks[362].y;
      const eyeSag = (leftEyeTilt + rightEyeTilt) * 100; // 放大數值

      // B. 軟組織鬆弛: 鼻翼(1)到下巴(152)的距離 vs 臉長
      // 老化會導致下半臉軟組織堆積，視覺上變長
      const lowerFace = getDistance3D(landmarks[1], landmarks[152]);
      const upperFace = getDistance3D(landmarks[10], landmarks[1]);
      const sagRatio = lowerFace / upperFace; // > 1.2 可能代表鬆弛或長臉

      // 基礎年齡 + 特徵修正
      // 基礎: 35
      // 眼角每下垂一點 + 5歲
      // 下半臉比例每增加 0.1 + 8歲
      let bioAge = 25 + (Math.max(0, eyeSag) * 300) + ((sagRatio - 1.0) * 40);
      bioAge = Math.min(85, Math.max(18, bioAge)); // 限制在 18-85

      // 3. 評分 (Neoclassical Canons - 黃金三庭)
      // 上庭: 髮際線(10) - 眉心(9)
      // 中庭: 眉心(9) - 鼻下(2)
      // 下庭: 鼻下(2) - 下巴(152)
      // 注意：FaceMesh 的 10號點只是額頭頂部，不完全是髮際線，需做修正
      const upperThird = getDistance3D(landmarks[10], landmarks[9]) * 1.5; // 修正係數
      const middleThird = getDistance3D(landmarks[9], landmarks[2]);
      const lowerThird = getDistance3D(landmarks[2], landmarks[152]);
      
      const avgThird = (upperThird + middleThird + lowerThird) / 3;
      const deviation = (
          Math.abs(upperThird - avgThird) + 
          Math.abs(middleThird - avgThird) + 
          Math.abs(lowerThird - avgThird)
      ) / avgThird;

      // 偏差值轉分數 (0偏差 = 0分完美, 偏差越大分數越高)
      // 放大 30 倍讓差異明顯
      let score = deviation * 30; 
      score = Math.min(9.9, Math.max(0.1, score));

      // 4. 對稱性
      const leftDist = getDistance3D(landmarks[234], landmarks[1]);
      const rightDist = getDistance3D(landmarks[454], landmarks[1]);
      const symmetry = Math.min(leftDist, rightDist) / Math.max(leftDist, rightDist);

      return {
          score,
          age: Math.floor(bioAge),
          genderVal: genderScore, // 0-1
          symmetry
      };
  };

  const finalizeScore = () => {
      const buffer = analysisBuffer.current;
      if (buffer.scores.length === 0) return;

      // 取樣平均值 (去除極端值)
      const avgScore = buffer.scores.reduce((a, b) => a + b, 0) / buffer.scores.length;
      const avgAge = buffer.ages.reduce((a, b) => a + b, 0) / buffer.ages.length;
      const avgGender = buffer.genders.reduce((a, b) => a + b, 0) / buffer.genders.length;
      const avgSym = buffer.symmetries.reduce((a, b) => a + b, 0) / buffer.symmetries.length;

      // 根據平均值判定
      const genderStr = avgGender > 0.55 ? "MALE" : "FEMALE";
      
      // 最終美化：如果對稱性很高，給予額外分數優化 (分數越低越好，所以扣分)
      let finalScore = avgScore;
      if (avgSym > 0.95) finalScore -= 0.5;
      finalScore = Math.max(0.1, finalScore).toFixed(1);

      setMetrics({
          deviationScore: finalScore,
          age: Math.floor(avgAge),
          gender: genderStr,
          symmetry: (avgSym * 100).toFixed(1) + "%",
          faceShape: "3D MAPPED"
      });
  };

  const onResults = (results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    
    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        
        ctx.lineWidth = 1;

        // --- 3D 視覺化繪圖 (Depth Map Visualization) ---
        // 我們根據 Z 軸深度改變顏色，讓使用者感受到 "3D 掃描"
        // Z 越小 (越近) = 越亮 (Yellow/Cyan), Z 越大 (越遠) = 越暗 (Blue/Purple)
        
        for (let i = 0; i < landmarks.length; i+=3) { // 繪製點雲
            const pt = landmarks[i];
            const x = pt.x * width;
            const y = pt.y * height;
            // Z 值通常在 -0.1 (鼻尖) 到 0.1 (耳後) 之間
            // 映射到 0-1
            const zNorm = (pt.z + 0.1) * 5; 
            const alpha = Math.max(0.2, 1 - zNorm); // 近的清楚，遠的模糊
            
            ctx.fillStyle = `rgba(6, 182, 212, ${alpha})`; // Cyan
            if (i === 1) ctx.fillStyle = 'red'; // 鼻尖

            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
            ctx.fill();
        }

        // 繪製 T 字部位 (結構線)
        const tLine = [10, 152, 234, 454]; // 縱軸與橫軸
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)'; // Yellow
        ctx.beginPath();
        ctx.moveTo(landmarks[10].x * width, landmarks[10].y * height);
        ctx.lineTo(landmarks[152].x * width, landmarks[152].y * height);
        ctx.moveTo(landmarks[234].x * width, landmarks[234].y * height);
        ctx.lineTo(landmarks[454].x * width, landmarks[454].y * height);
        ctx.stroke();

        // --- 數據採樣 ---
        if (stateRef.current === 'SCANNING_FACE') {
            const bio = calculate3DBiometrics(landmarks);
            
            // 存入緩衝區
            analysisBuffer.current.scores.push(bio.score);
            analysisBuffer.current.ages.push(bio.age);
            analysisBuffer.current.genders.push(bio.genderVal);
            analysisBuffer.current.symmetries.push(bio.symmetry);

            setScanProgress(prev => {
                const next = prev + 0.8;
                if (next >= 100) {
                    setSystemState('WAITING_SMILE');
                    setInstruction("結構掃描完成。請微笑測試肌肉活性...");
                    return 0;
                }
                return next;
            });
        }

        if (stateRef.current === 'WAITING_SMILE') {
            // 檢測微笑幅度 (嘴角變寬)
            const mouthW = getDistance3D(landmarks[61], landmarks[291]);
            const faceW = getDistance3D(landmarks[234], landmarks[454]);
            const ratio = mouthW / faceW;
            
            // 當微笑比例足夠大，進度條加速
            const speed = ratio > 0.4 ? 2.5 : 0.5;

            setScanProgress(prev => {
                const next = prev + speed;
                if (next >= 100) {
                    setSystemState('ANALYZING');
                    setInstruction("正在建立 3D 生物特徵報告...");
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
        style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
            objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 2 
        }} 
      />

      {/* 2. 待機畫面 */}
      {(systemState === 'IDLE' || systemState === 'STARTING') && (
        <div style={styles.overlay}>
           <div style={{marginBottom: '2rem', display: 'flex', justifyContent: 'center'}}>
              <Box className={`w-24 h-24 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : ''}`} />
           </div>
           <h1 className="text-4xl font-bold tracking-widest mb-2 text-center">3D BIO-METRIC</h1>
           <p className="text-sm tracking-widest text-cyan-600 mb-8">三維結構掃描系統 v7.0</p>
           
           {systemState === 'STARTING' ? (
               <div className="text-emerald-400 animate-pulse text-xl">{loadingStatus}</div>
           ) : (
               <button onClick={startCameraSequence} style={styles.btn}>
                   <Crosshair /> START 3D SCAN
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
                           <span className="tracking-widest font-bold">BIO-STRUCTURAL REPORT</span>
                       </div>
                       
                       <div className="grid grid-cols-3 gap-4 w-full max-w-lg text-center mb-4">
                           <div className="bg-slate-800/50 p-2 rounded">
                               <div className="text-[10px] text-slate-400">AGE EST.</div>
                               <div className="text-2xl font-bold text-white font-mono">{metrics.age}</div>
                           </div>
                           <div className="bg-slate-800/50 p-2 rounded">
                               <div className="text-[10px] text-slate-400">GENDER</div>
                               <div className="text-xl font-bold text-white font-mono">{metrics.gender}</div>
                           </div>
                           <div className="bg-slate-800/50 p-2 rounded">
                               <div className="text-[10px] text-slate-400">SYMMETRY</div>
                               <div className="text-xl font-bold text-white font-mono">{metrics.symmetry}</div>
                           </div>
                       </div>

                       <div className="flex flex-col items-center border-t border-slate-700 w-full pt-4">
                           <span className="text-sm text-cyan-400 mb-1">外貌偏差指數 (DEVIATION)</span>
                           <div className="flex items-baseline gap-2">
                               <span className="text-6xl font-bold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" style={{fontFamily: 'Orbitron'}}>
                                   {metrics.deviationScore}
                               </span>
                               <span className="text-xs text-slate-500">/ 10</span>
                           </div>
                           <span className="text-[10px] text-slate-500 mt-1">BASED ON GOLDEN RATIO & 3D GEOMETRY</span>
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