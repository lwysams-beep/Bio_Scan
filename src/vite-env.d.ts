/// <reference types="vite/client" />

// 告訴 TypeScript window 物件上有這些 AI 相關的變數
interface Window {
    FaceMesh: any;
    Pose: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    POSE_CONNECTIONS: any;
    FACEMESH_TESSELATION: any;
  }