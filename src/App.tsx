import React, { useState, useEffect, useRef } from 'react';
import { Scan, Activity, Brain, RefreshCw, Fingerprint, Crosshair, Smile, User, Dna, Microscope, Box, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Music, Eye, Hash } from 'lucide-react';

// BioFuture Scan - v10.1 亞洲神顏校準版
// 1. [男性標準] 0 分基準改為 Jeffrey Ngai (魏俊笙)：強調亞洲立體感、大眼與少年感下顎
// 2. [女性標準] 保持 Blackpink 標準：短中庭、幼態比例
// 3. [器官分析] 針對亞洲人臉型調整眼、鼻評分權重，移除歐美過高鼻樑的標準
// 4. [測試對象] 全亞洲人臉資料庫模型校準

const MP_VERSION = '0.4.1633559619'; 

const TESSELATION_CONNECTIONS = [
  [127, 34], [34, 139], [139, 127], 
  [356, 264], [264, 368], [368, 356], 
  [10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389], 
  [10, 109], [109, 67], [67, 103], [103, 54], [54, 21], [21, 162], 
  [168, 6], [6, 197], [197, 195], [195, 5], [5, 4], [4, 1], [1, 19], [19, 94], [94, 2], 
  [1, 122], [122, 196], [196, 3], [3, 51], [51, 45], [45, 1], 
  [61, 185], [185, 40], [40, 39], [39, 37], [37, 0], [0, 267], [267, 269], [269, 270], [270, 409], [409, 291], 
  [61, 146], [146, 91], [91, 181], [181, 84], [84, 17], [17, 314], [314, 405], [405, 321], [321, 375], [375, 291], 
  [33, 7], [7, 163], [163, 144], [144, 145], [145, 153], [153, 154], [154, 155], [155, 133], 
  [362, 382], [382, 381], [381, 380], [380, 374], [374, 373], [373, 390], [390, 249], [249, 263], 
  [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172], [172, 58], [58, 132], [132, 93], [93, 234], 
  [152, 377], [377, 400], [400, 378], [378, 379], [379, 365], [365, 397], [397, 288], [288, 361], [361, 323], [323, 454] 
];

export default function BioFutureScanApp() {
  const [logs, setLogs] = useState([]); 
  const [videoKey, setVideoKey] = useState(0); 
  
  const [systemState, setSystemState] = useState('IDLE'); 
  const [loadingStatus, setLoadingStatus] = useState("SYSTEM STANDBY");
  const [instruction, setInstruction] = useState("");
  
  // 核心數據 - 擴充版
  const [metrics, setMetrics] = useState({
    deviationScore: 0, 
    age: 0, 
    gender: 'ANALYZING',
    symmetry: '0%',
    faceShape: 'SCANNING',
    eyeSize: 'ANALYZING',
    noseShape: 'ANALYZING',
    teethGrade: 'ANALYZING',
    rank: 'ANALYZING' 
  });
  
  const [scanProgress, setScanProgress] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const isLooping = useRef(false);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  
  const stateRef = useRef('IDLE'); 
  
  // 數據緩衝區
  const analysisBuffer = useRef({
    scores: [],
    ages: [],
    genders: [], 
    symmetries: [],
    eyeRatios: [],
    noseHeights: [],
    noseWidths: [],
    smileScores: []
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

    addLog("Asian Idol Database Loaded.");
    initAI();

    return () => stopCamera(); 
  }, []);

  const playSuccessSound = (type = 'major') => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playNote = (freq, time, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine'; 
        
        gain.gain.setValueAtTime(0.05, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
      };

      const now = ctx.currentTime;
      if (type === 'major') {
          playNote(523.25, now, 0.3); 
          playNote(659.25, now + 0.1, 0.3); 
          playNote(783.99, now + 0.2, 0.5); 
      } else if (type === 'scan') {
          playNote(1200, now, 0.1);
      } else if (type === 'complete') {
          playNote(523.25, now, 0.6);
          playNote(783.99, now, 0.6);
          playNote(1046.50, now, 0.6);
      }

    } catch (e) { console.error(e); }
  };

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
        try { await video.play(); } 
        catch(playError) { video.muted = true; await video.play(); }

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
                  addLog(`Calibrated: ${video.videoWidth}x${video.videoHeight}`);
              }
              startScanningMode(); 
          }
      }, 100);
  };

  const startScanningMode = () => {
      analysisBuffer.current = { scores: [], ages: [], genders: [], symmetries: [], eyeRatios: [], noseHeights: [], noseWidths: [], smileScores: [] };
      setSystemState('SCAN_CENTER');
      setInstruction("請正視前方，建立基準地形...");
      setScanProgress(0);
      playSuccessSound('scan'); 
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
            minDetectionConfidence: 0.7, 
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

  // --- 🧬 3D 運算 ---
  const getDistance3D = (p1, p2) => {
      return Math.sqrt(
          Math.pow(p1.x - p2.x, 2) + 
          Math.pow(p1.y - p2.y, 2) + 
          Math.pow(p1.z - p2.z, 2) 
      );
  };

  const detectHeadPose = (landmarks) => {
      const leftZ = landmarks[234].z;
      const rightZ = landmarks[454].z;
      const yaw = leftZ - rightZ; 
      
      const topZ = landmarks[10].z;
      const chinZ = landmarks[152].z;
      const pitch = topZ - chinZ; 

      return { yaw, pitch };
  };

  // --- 🌟 亞洲神顏評分模型 (Asian Idol Standard) ---
  const calculateBiometrics = (landmarks) => {
      // 1. 臉型長寬比 (Golden Ratio) 
      // 亞洲人臉型較寬，理想值調整為 1.55 (Blackpink / Jeffrey 比例)
      const faceHeight = getDistance3D(landmarks[10], landmarks[152]);
      const faceWidth = getDistance3D(landmarks[234], landmarks[454]);
      const ratio = faceHeight / faceWidth;
      const goldenDev = Math.abs(ratio - 1.55) / 1.55;

      // 2. 中下庭比例 (幼態感關鍵)
      // 中庭(9-2) 與 下庭(2-152) 接近 1:1 或 中庭略短 (0.95)
      const middleThird = getDistance3D(landmarks[9], landmarks[2]);
      const lowerThird = getDistance3D(landmarks[2], landmarks[152]);
      const midLowRatio = middleThird / lowerThird;
      const midLowDev = Math.abs(midLowRatio - 0.95);

      // 3. 對稱性 (亞洲人對對稱性要求極高)
      const leftDist = getDistance3D(landmarks[234], landmarks[1]);
      const rightDist = getDistance3D(landmarks[454], landmarks[1]);
      const symmetryVal = Math.min(leftDist, rightDist) / Math.max(leftDist, rightDist);
      const symmetryDev = 1 - symmetryVal;

      // 4. [亞洲標準] 眼部大小分析 (Eye Ratio)
      // 亞洲人臉寬較大，眼寬/臉寬 > 0.225 即為頂級大眼 (Jeffrey / Lisa)
      // 一般人約 0.2，歐美標準可能要 0.25
      const leftEyeW = getDistance3D(landmarks[33], landmarks[133]);
      const rightEyeW = getDistance3D(landmarks[362], landmarks[263]);
      const avgEyeW = (leftEyeW + rightEyeW) / 2;
      const eyeRatio = avgEyeW / faceWidth;
      const eyeDev = Math.max(0, 0.225 - eyeRatio) * 5; 

      // 5. [亞洲標準] 鼻型結構分析 (Nose Structure)
      // 鼻寬: 鼻翼/臉寬 理想約 0.25
      const noseW = getDistance3D(landmarks[49], landmarks[279]);
      const noseRatio = noseW / faceWidth; 
      const noseWidthDev = Math.abs(noseRatio - 0.25) * 10;

      // 鼻高: 移除歐美 Beckham 標準
      // Jeffrey Ngai 的鼻子立體但不過於突兀。Z軸差約 0.055 - 0.065 為完美區間
      const avgCheekZ = (landmarks[234].z + landmarks[454].z) / 2;
      const noseZ = landmarks[1].z;
      const noseHeightMetric = Math.abs(avgCheekZ - noseZ); 
      // 偏差計算：偏離 0.06 越多扣分越多
      const noseHeightScore = noseHeightMetric * 100;
      const noseHeightDev = Math.abs(noseHeightMetric - 0.06) * 15; 

      // 6. 綜合評分
      // 權重分配: 對稱(30%) + 中庭(25%) + 黃金比(15%) + 眼(15%) + 鼻(15%)
      const totalDev = (goldenDev * 0.15) + (midLowDev * 0.25) + (symmetryDev * 0.3) + (eyeDev * 0.15) + (noseHeightDev * 0.15);
      
      let rawScore = totalDev * 30;
      
      // 獎勵機制：如果符合 Jeffrey/Lisa 特徵 (短中庭+大眼)
      if (midLowRatio < 1.0 && eyeRatio > 0.21) rawScore *= 0.7; 

      rawScore = Math.min(9.9, Math.max(0.1, rawScore));

      // 性別與年齡
      const cheekWidth = getDistance3D(landmarks[234], landmarks[454]);
      const jawWidth = getDistance3D(landmarks[58], landmarks[288]);
      const jawRatio = jawWidth / cheekWidth;
      const genderScore = Math.max(0, Math.min(1, (jawRatio - 0.75) * 5));

      const leftEyeTilt = landmarks[33].y - landmarks[133].y; 
      const rightEyeTilt = landmarks[263].y - landmarks[362].y;
      const eyeSag = (leftEyeTilt + rightEyeTilt) * 50; 
      let bioAge = 20 + (Math.max(0, eyeSag) * 200) + (rawScore * 1.8); 
      bioAge = Math.min(85, Math.max(16, bioAge)); 

      return {
          score: rawScore,
          age: Math.floor(bioAge),
          genderVal: genderScore, 
          symmetry: symmetryVal,
          eyeRatio,
          noseHeight: noseHeightScore,
          noseRatio
      };
  };

  const calculateSmileEsthetics = (landmarks) => {
      // 牙齒/笑容美觀度
      const mouthW = getDistance3D(landmarks[61], landmarks[291]);
      const faceW = getDistance3D(landmarks[234], landmarks[454]);
      const widthRatio = mouthW / faceW; 

      const lipOpen = getDistance3D(landmarks[13], landmarks[14]);
      const fullness = lipOpen / mouthW; 

      const nose = landmarks[1];
      const leftC = landmarks[61];
      const rightC = landmarks[291];
      const lDist = Math.hypot(leftC.x - nose.x, leftC.y - nose.y);
      const rDist = Math.hypot(rightC.x - nose.x, rightC.y - nose.y);
      const sym = Math.min(lDist, rDist) / Math.max(lDist, rDist);

      let grade = 5;
      if (widthRatio > 0.4 && fullness > 0.1) grade = 8;
      if (widthRatio > 0.45 && fullness > 0.15 && sym > 0.95) grade = 10;
      if (widthRatio < 0.3) grade = 3;

      return grade; 
  };

  const finalizeScore = () => {
      const buffer = analysisBuffer.current;
      if (buffer.scores.length === 0) return;

      const sortedScores = buffer.scores.sort((a, b) => a - b);
      const cutOff = Math.floor(sortedScores.length * 0.2);
      const validScores = sortedScores.slice(cutOff, sortedScores.length - cutOff);
      
      let avgScore = 5.0;
      if (validScores.length > 0) {
          avgScore = validScores.reduce((a, b) => a + b, 0) / validScores.length;
      }

      const avgAge = buffer.ages.reduce((a, b) => a + b, 0) / buffer.ages.length;
      const avgGender = buffer.genders.reduce((a, b) => a + b, 0) / buffer.genders.length;
      const avgSym = buffer.symmetries.reduce((a, b) => a + b, 0) / buffer.symmetries.length;
      
      const avgEye = buffer.eyeRatios.reduce((a, b) => a + b, 0) / buffer.eyeRatios.length;
      const avgNoseH = buffer.noseHeights.reduce((a, b) => a + b, 0) / buffer.noseHeights.length;
      const avgNoseW = buffer.noseWidths.reduce((a, b) => a + b, 0) / buffer.noseWidths.length;
      
      const avgSmile = buffer.smileScores.length > 0 
          ? buffer.smileScores.reduce((a, b) => a + b, 0) / buffer.smileScores.length 
          : 5;

      const genderStr = avgGender > 0.55 ? "MALE" : "FEMALE";
      
      if (avgSmile > 8) avgScore -= 0.5; 
      
      // 鼻高太高或太低都不好 (追求 Jeffrey 的適中立體感 6.0)
      if (avgNoseH > 5.5 && avgNoseH < 7.5) avgScore -= 0.3; 

      let finalScore = Math.max(0.1, avgScore).toFixed(1);

      // 文字描述轉換 (Asian Standards)
      const eyeStr = avgEye > 0.225 ? "LARGE (IDOL)" : (avgEye > 0.19 ? "MEDIUM" : "SMALL");
      const noseStr = (avgNoseH > 5.5 && avgNoseH < 7.5) ? "IDEAL ASIAN BRIDGE" : (avgNoseH >= 7.5 ? "HIGH (WESTERN)" : "FLAT");
      const teethStr = avgSmile > 8 ? "PERFECT SMILE" : (avgSmile > 5 ? "NATURAL" : "CONCEALED");

      let rank = "AVERAGE";
      if (finalScore <= 2.0) rank = "IDOL TIER (JEFFREY/BP LEVEL)";     
      else if (finalScore <= 4.0) rank = "TOP TIER (MODEL)"; 
      else if (finalScore <= 6.5) rank = "STANDARD (NORMAL)";    
      else if (finalScore <= 8.5) rank = "DEVIATED";  
      else rank = "EXTREME";

      setMetrics({
          deviationScore: finalScore,
          age: Math.floor(avgAge),
          gender: genderStr,
          symmetry: (avgSym * 100).toFixed(1) + "%",
          rank: rank,
          eyeSize: eyeStr,
          noseShape: noseStr,
          teethGrade: teethStr
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

        // --- 3D 地形圖 (Topo-Map) ---
        TESSELATION_CONNECTIONS.forEach(([start, end]) => {
            const p1 = landmarks[start];
            const p2 = landmarks[end];
            const zAvg = (p1.z + p2.z) / 2; 
            const brightness = Math.max(20, 100 - (zAvg + 0.1) * 400); 
            
            ctx.strokeStyle = `hsl(180, 100%, ${brightness}%)`; 
            ctx.beginPath();
            ctx.moveTo(p1.x * width, p1.y * height);
            ctx.lineTo(p2.x * width, p2.y * height);
            ctx.stroke();
        });

        // 關鍵點加強
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        [1, 10, 152, 234, 454, 13, 14].forEach(idx => {
            const pt = landmarks[idx];
            ctx.beginPath();
            ctx.arc(pt.x * width, pt.y * height, 2, 0, 2 * Math.PI);
            ctx.fill();
        });

        // --- 動態掃描邏輯 ---
        const pose = detectHeadPose(landmarks);
        const bio = calculateBiometrics(landmarks);
        
        // 採樣數據
        if (['SCAN_CENTER', 'SCAN_LEFT', 'SCAN_RIGHT', 'SCAN_UP', 'SCAN_DOWN'].includes(stateRef.current)) {
             analysisBuffer.current.scores.push(bio.score);
             analysisBuffer.current.ages.push(bio.age);
             analysisBuffer.current.genders.push(bio.genderVal);
             analysisBuffer.current.symmetries.push(bio.symmetry);
             
             analysisBuffer.current.eyeRatios.push(bio.eyeRatio);
             analysisBuffer.current.noseHeights.push(bio.noseHeight);
             analysisBuffer.current.noseWidths.push(bio.noseRatio);
        }

        const THRESHOLD = 0.025; 
        const SPEED = 2.5; 

        if (stateRef.current === 'SCAN_CENTER') {
            const isCenter = Math.abs(pose.yaw) < 0.03 && Math.abs(pose.pitch) < 0.03;
            if (isCenter) {
                setScanProgress(prev => {
                    const next = prev + 4.0; 
                    if (next >= 100) {
                        playSuccessSound('major'); 
                        setSystemState('SCAN_LEFT');
                        setInstruction("請向左轉頭...");
                        return 0;
                    }
                    return next;
                });
            } else {
               setScanProgress(prev => prev + 0.2);
            }
        }

        if (stateRef.current === 'SCAN_LEFT') {
            if (pose.yaw < -THRESHOLD) { 
                setScanProgress(prev => {
                    const next = prev + SPEED;
                    if (next >= 100) {
                        playSuccessSound('major');
                        setSystemState('SCAN_RIGHT');
                        setInstruction("請向右轉頭...");
                        return 0;
                    }
                    return next;
                });
            }
        }

        if (stateRef.current === 'SCAN_RIGHT') {
            if (pose.yaw > THRESHOLD) {
                setScanProgress(prev => {
                    const next = prev + SPEED;
                    if (next >= 100) {
                        playSuccessSound('major');
                        setSystemState('SCAN_UP');
                        setInstruction("請稍微抬頭...");
                        return 0;
                    }
                    return next;
                });
            }
        }

        if (stateRef.current === 'SCAN_UP') {
            if (pose.pitch > THRESHOLD) {
                setScanProgress(prev => {
                    const next = prev + SPEED;
                    if (next >= 100) {
                        playSuccessSound('major');
                        setSystemState('SCAN_DOWN');
                        setInstruction("請稍微低頭...");
                        return 0;
                    }
                    return next;
                });
            }
        }

        if (stateRef.current === 'SCAN_DOWN') {
            if (pose.pitch < -THRESHOLD) {
                setScanProgress(prev => {
                    const next = prev + SPEED;
                    if (next >= 100) {
                        playSuccessSound('major'); 
                        setSystemState('WAITING_SMILE');
                        setInstruction("掃描完成。請展露微笑 (檢測牙齒)...");
                        return 0;
                    }
                    return next;
                });
            }
        }

        // 微笑測試 (含牙齒分析)
        if (stateRef.current === 'WAITING_SMILE') {
            const smileGrade = calculateSmileEsthetics(landmarks);
            if (smileGrade > 4) {
               analysisBuffer.current.smileScores.push(smileGrade);
            }

            const mouthW = getDistance3D(landmarks[61], landmarks[291]);
            const faceW = getDistance3D(landmarks[234], landmarks[454]);
            const ratio = mouthW / faceW;
            
            if (ratio > 0.45) { 
                setScanProgress(prev => {
                    const next = prev + 2.5;
                    if (next >= 100) {
                        playSuccessSound('complete'); 
                        setSystemState('ANALYZING');
                        setInstruction("正在生成 3D 綜合報告...");
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

      {(systemState === 'IDLE' || systemState === 'STARTING') && (
        <div style={styles.overlay}>
           <div style={{marginBottom: '2rem', display: 'flex', justifyContent: 'center'}}>
              <Box className={`w-24 h-24 text-cyan-400 ${systemState === 'STARTING' ? 'animate-spin' : ''}`} />
           </div>
           <h1 className="text-4xl font-bold tracking-widest mb-2 text-center">3D OMNI-SCAN</h1>
           <p className="text-sm tracking-widest text-cyan-600 mb-8">醫美級生物掃描 v10.1</p>
           
           {systemState === 'STARTING' ? (
               <div className="text-emerald-400 animate-pulse text-xl">{loadingStatus}</div>
           ) : (
               <button onClick={startCameraSequence} style={styles.btn}>
                   <Crosshair /> START SYSTEM
               </button>
           )}
        </div>
      )}

      {systemState !== 'IDLE' && systemState !== 'STARTING' && (
        <div className="absolute top-0 left-0 w-full z-20 pointer-events-none p-4 pt-8 md:pt-12">
           <div className="bg-slate-900/80 backdrop-blur-md border-b-2 border-cyan-500 p-4 rounded-b-2xl shadow-[0_0_30px_rgba(6,182,212,0.3)] flex flex-col items-center">
               
               {systemState === 'RESULT' ? (
                   <div className="w-full flex flex-col items-center animate-fade-in-down">
                       <div className="flex items-center gap-2 text-yellow-400 mb-2">
                           <Brain className="w-5 h-5" />
                           <span className="tracking-widest font-bold">ASIAN AESTHETICS REPORT</span>
                       </div>
                       
                       {/* 綜合數據面板 */}
                       <div className="grid grid-cols-2 gap-2 w-full max-w-lg text-center mb-4">
                           <div className="bg-slate-800/50 p-2 rounded flex flex-col justify-center">
                               <div className="text-[10px] text-slate-400">GENDER / AGE</div>
                               <div className="text-lg font-bold text-white font-mono">{metrics.gender} / {metrics.age}</div>
                           </div>
                           <div className="bg-slate-800/50 p-2 rounded flex flex-col justify-center">
                               <div className="text-[10px] text-slate-400">SYMMETRY</div>
                               <div className="text-lg font-bold text-white font-mono">{metrics.symmetry}</div>
                           </div>
                           
                           {/* 新增特徵面板 */}
                           <div className="bg-slate-800/50 p-2 rounded flex flex-col justify-center">
                               <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><Eye size={10}/> EYE SIZE</div>
                               <div className="text-sm font-bold text-cyan-300 font-mono">{metrics.eyeSize}</div>
                           </div>
                           <div className="bg-slate-800/50 p-2 rounded flex flex-col justify-center">
                               <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><Hash size={10}/> NOSE SHAPE</div>
                               <div className="text-sm font-bold text-cyan-300 font-mono">{metrics.noseShape}</div>
                           </div>
                           <div className="bg-slate-800/50 p-2 rounded col-span-2 flex flex-col justify-center">
                               <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><Smile size={10}/> DENTAL ESTHETICS</div>
                               <div className="text-sm font-bold text-cyan-300 font-mono">{metrics.teethGrade}</div>
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
                           <span className="text-[10px] text-yellow-500 mt-1 font-bold tracking-widest">{metrics.rank}</span>
                           <span className="text-[9px] text-slate-500 mt-1">0 = BLACKPINK & JEFFREY NGAI LEVEL</span>
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
                   <div className="flex flex-col items-center w-full">
                       <div className="flex items-center gap-2 text-cyan-400 mb-1">
                           {systemState === 'WAITING_SMILE' ? <Smile className="w-6 h-6 animate-bounce" /> : 
                            systemState.includes('SCAN_') ? <RefreshCw className="w-6 h-6 animate-spin" /> :
                            <Scan className="w-6 h-6 animate-pulse" />}
                           <span className="text-lg font-bold tracking-widest text-center">{instruction}</span>
                       </div>
                       
                       <div className="flex gap-4 my-2 text-slate-600">
                           <ChevronLeft className={systemState === 'SCAN_LEFT' ? 'text-cyan-400 animate-pulse scale-125' : ''} />
                           <ChevronUp className={systemState === 'SCAN_UP' ? 'text-cyan-400 animate-pulse scale-125' : ''} />
                           <ChevronDown className={systemState === 'SCAN_DOWN' ? 'text-cyan-400 animate-pulse scale-125' : ''} />
                           <ChevronRight className={systemState === 'SCAN_RIGHT' ? 'text-cyan-400 animate-pulse scale-125' : ''} />
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