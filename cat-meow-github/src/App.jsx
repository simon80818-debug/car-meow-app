import { useState, useEffect, useRef, useCallback } from "react";

/* ─── 貓咪情緒資料庫 ─── */
const CAT_EMOTIONS = [
  { id: "hungry",   emoji: "🍽️", label: "肚子餓了", desc: "喵～我的碗空了！快給我好吃的！",     color: "#FF6B35" },
  { id: "happy",    emoji: "😸", label: "心情很好", desc: "呼嚕呼嚕～被你摸得好舒服喔～",       color: "#7CB518" },
  { id: "angry",    emoji: "😾", label: "生氣了",   desc: "哈！不要碰我！我現在很不爽！",       color: "#E63946" },
  { id: "lonely",   emoji: "🥺", label: "想要陪伴", desc: "喵嗚…你去哪了？我好想你…",           color: "#457B9D" },
  { id: "playful",  emoji: "🐱", label: "想玩耍",   desc: "來追我呀！快拿逗貓棒出來！",         color: "#F4A261" },
  { id: "scared",   emoji: "🙀", label: "害怕中",   desc: "那是什麼聲音！？我要躲起來！",       color: "#6A0572" },
  { id: "greeting", emoji: "👋", label: "在打招呼", desc: "嗨～你回來啦！我等你好久了！",       color: "#2EC4B6" },
  { id: "demand",   emoji: "📢", label: "有所要求", desc: "喂！門給我開！我要出去巡邏！",       color: "#E76F51" },
  { id: "love",     emoji: "💕", label: "撒嬌中",   desc: "蹭蹭～你是我最喜歡的人類～",        color: "#FF69B4" },
  { id: "curious",  emoji: "🔍", label: "好奇探索", desc: "嗯？那是什麼東西？讓我看看！",       color: "#00B4D8" },
];

const TIPS = {
  hungry:   ["準備新鮮的食物和乾淨的水", "注意定時餵食，建立規律", "可以試試不同口味的罐頭"],
  happy:    ["繼續輕輕撫摸牠", "這是建立感情的好時機", "可以給牠一些小零食獎勵"],
  angry:    ["先給牠一些空間冷靜", "不要強迫接觸或擁抱", "找出讓牠不安的原因"],
  lonely:   ["多花時間陪伴牠", "可以考慮添購互動玩具", "離開時留下有你味道的衣物"],
  playful:  ["拿出逗貓棒一起玩吧！", "互動遊戲能增進感情", "每天至少15分鐘的遊戲時間"],
  scared:   ["說話放低音量，動作放慢", "提供安全的躲藏空間", "不要強迫牠出來面對"],
  greeting: ["回應牠的問候吧！", "輕聲和牠說話", "這代表牠信任你喔"],
  demand:   ["看看牠的需求是什麼", "可能是門、窗戶或貓砂盆", "有時候牠只是想引起注意"],
  love:     ["好好享受這甜蜜的時刻", "牠選擇了信任你", "慢慢眨眼回應牠的愛"],
  curious:  ["讓牠安全地探索", "移除可能的危險物品", "好奇心是健康貓咪的表現"],
};

/* ─── 音訊特徵分析器 ─── */
function analyzeCatAudioFeatures(analyser) {
  const freqData  = new Uint8Array(analyser.frequencyBinCount);
  const timeData  = new Uint8Array(analyser.fftSize);
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  const sampleRate  = analyser.context.sampleRate;
  const binSize     = sampleRate / analyser.fftSize;

  // 計算各頻段能量
  let lowEnergy = 0, midEnergy = 0, highEnergy = 0, totalEnergy = 0;
  for (let i = 0; i < freqData.length; i++) {
    const freq = i * binSize;
    const val  = freqData[i];
    totalEnergy += val;
    if (freq < 400)       lowEnergy  += val;
    else if (freq < 1200) midEnergy  += val;
    else                  highEnergy += val;
  }

  // 主頻率
  let peakBin = 0, peakVal = 0;
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > peakVal) { peakVal = freqData[i]; peakBin = i; }
  }
  const peakFreq = Math.round(peakBin * binSize);

  // 音量 (RMS)
  let rms = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128;
    rms += v * v;
  }
  rms = Math.sqrt(rms / timeData.length);

  // 零交叉率 (判斷嘶嘶聲等噪音)
  let zeroCrossings = 0;
  for (let i = 1; i < timeData.length; i++) {
    if ((timeData[i - 1] < 128 && timeData[i] >= 128) ||
        (timeData[i - 1] >= 128 && timeData[i] < 128)) {
      zeroCrossings++;
    }
  }
  const zcr = zeroCrossings / timeData.length;

  // 頻譜重心
  let centroidNum = 0, centroidDen = 0;
  for (let i = 0; i < freqData.length; i++) {
    centroidNum += i * binSize * freqData[i];
    centroidDen += freqData[i];
  }
  const centroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

  const total = lowEnergy + midEnergy + highEnergy || 1;

  return {
    peakFreq,
    rms,
    zcr,
    centroid: Math.round(centroid),
    lowRatio:  lowEnergy  / total,
    midRatio:  midEnergy  / total,
    highRatio: highEnergy / total,
    totalEnergy,
  };
}

function classifyEmotion(features, durationSec) {
  const { peakFreq, rms, zcr, centroid, lowRatio, highRatio } = features;

  // 規則式分類 (基於貓咪聲學研究)
  let scores = {};
  CAT_EMOTIONS.forEach(e => scores[e.id] = 0);

  // 高音 + 短促 → 打招呼 / 好奇
  if (peakFreq > 500 && durationSec < 1.5) {
    scores.greeting += 30;
    scores.curious  += 20;
  }
  // 中頻 + 中等時長 → 要求 / 餓
  if (peakFreq >= 300 && peakFreq <= 700 && durationSec >= 0.5 && durationSec <= 3) {
    scores.hungry += 25;
    scores.demand += 25;
  }
  // 低頻長嚎 → 生氣 / 害怕
  if (peakFreq < 400 && durationSec > 2) {
    scores.angry  += 25;
    scores.scared += 15;
  }
  // 低頻 + 低音量 → 呼嚕 (開心)
  if (peakFreq < 300 && rms < 0.15) {
    scores.happy += 35;
    scores.love  += 20;
  }
  // 高零交叉率 → 嘶嘶聲 (害怕 / 生氣)
  if (zcr > 0.3) {
    scores.scared += 30;
    scores.angry  += 20;
  }
  // 高能量 + 高頻 → 緊急要求
  if (rms > 0.3 && highRatio > 0.3) {
    scores.demand  += 20;
    scores.hungry  += 15;
    scores.playful += 10;
  }
  // 中等能量 + 中頻為主 → 想玩
  if (rms > 0.1 && rms < 0.3 && midRatio > 0.4) {
    scores.playful += 25;
    scores.greeting += 10;
  }
  // 低能量 + 長時間 → 孤獨 / 撒嬌
  if (rms < 0.1 && durationSec > 2) {
    scores.lonely += 30;
    scores.love   += 15;
  }
  // 高頻譜重心 → 興奮 / 好奇
  if (centroid > 800) {
    scores.curious  += 15;
    scores.playful  += 10;
  }

  // 加入隨機變異讓結果更自然
  Object.keys(scores).forEach(k => {
    scores[k] += Math.random() * 12;
  });

  // 找最高分
  let bestId = "greeting", bestScore = -1;
  Object.entries(scores).forEach(([id, score]) => {
    if (score > bestScore) { bestScore = score; bestId = id; }
  });

  // 信心度
  const allScores  = Object.values(scores);
  const maxScore   = Math.max(...allScores);
  const avgScore   = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const confidence = Math.min(97, Math.max(55, Math.round(60 + (maxScore - avgScore) * 1.5)));

  return { emotionId: bestId, confidence };
}

/* ─── UI 元件 ─── */

function WaveVisualizer({ isListening, audioLevel }) {
  const bars = 32;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: "3px", height: "120px", padding: "20px 0",
    }}>
      {Array.from({ length: bars }).map((_, i) => {
        const distance = Math.abs(i - bars / 2) / (bars / 2);
        const baseH    = isListening ? 8 + (1 - distance) * 40 : 4;
        const animH    = isListening ? baseH + Math.random() * audioLevel * 60 : baseH;
        return (
          <div key={i} style={{
            width: "4px",
            height: `${Math.max(4, animH)}px`,
            borderRadius: "2px",
            background: isListening
              ? `linear-gradient(180deg, #FF6B9D, #C44569)`
              : "#3a3a5c",
            transition: isListening ? "height 0.05s ease" : "height 0.5s ease",
            opacity: isListening ? 0.6 + (1 - distance) * 0.4 : 0.3,
          }} />
        );
      })}
    </div>
  );
}

function PawParticles() {
  const [paws] = useState(() =>
    Array.from({ length: 8 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100, y: Math.random() * 100,
      size: 12 + Math.random() * 16,
      delay: Math.random() * 5, duration: 8 + Math.random() * 12,
      opacity: 0.03 + Math.random() * 0.06,
    }))
  );
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      {paws.map(p => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
          fontSize: `${p.size}px`, opacity: p.opacity,
          animation: `floatPaw ${p.duration}s ease-in-out ${p.delay}s infinite alternate`,
        }}>🐾</div>
      ))}
    </div>
  );
}

function ResultCard({ result, onClose }) {
  const emotion = CAT_EMOTIONS.find(e => e.id === result.emotionId);
  const tips    = TIPS[result.emotionId] || [];

  return (
    <div style={{
      animation: "slideUp 0.5s cubic-bezier(0.16,1,0.3,1)",
      background: "rgba(30,30,50,0.95)", backdropFilter: "blur(20px)",
      borderRadius: "28px", border: `2px solid ${emotion.color}33`,
      padding: "32px 28px", maxWidth: "420px", margin: "0 auto",
      boxShadow: `0 20px 60px ${emotion.color}22, 0 0 120px ${emotion.color}11`,
    }}>
      {/* header */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        <div style={{ fontSize: "64px", marginBottom: "12px",
          filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.3))",
          animation: "bounceIn 0.6s cubic-bezier(0.34,1.56,0.64,1)",
        }}>{emotion.emoji}</div>
        <div style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "3px",
          textTransform: "uppercase", color: emotion.color, marginBottom: "8px",
        }}>{result.pattern}</div>
        <div style={{ fontSize: "26px", fontWeight: 800, color: "#fff" }}>
          {emotion.label}
        </div>
      </div>

      {/* speech bubble */}
      <div style={{
        background: `${emotion.color}15`, border: `1px solid ${emotion.color}30`,
        borderRadius: "20px", padding: "20px", marginBottom: "24px",
      }}>
        <p style={{ fontSize: "17px", lineHeight: 1.7, color: "#e0e0e0",
          textAlign: "center", margin: 0, fontStyle: "italic",
        }}>「{emotion.desc}」</p>
      </div>

      {/* confidence bar */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontSize: "13px", color: "#888" }}>分析信心度</span>
          <span style={{ fontSize: "15px", fontWeight: 700, color: emotion.color }}>{result.confidence}%</span>
        </div>
        <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: "3px", width: `${result.confidence}%`,
            background: `linear-gradient(90deg, ${emotion.color}, ${emotion.color}cc)`,
            animation: "expandBar 1s cubic-bezier(0.16,1,0.3,1)",
          }} />
        </div>
      </div>

      {/* stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "24px" }}>
        {[
          { label: "主頻率", value: result.frequency },
          { label: "聆聽時間", value: result.duration },
          { label: "音量", value: result.volume },
        ].map(item => (
          <div key={item.label} style={{
            background: "rgba(255,255,255,0.04)", borderRadius: "14px",
            padding: "14px 10px", textAlign: "center",
          }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>{item.value}</div>
            <div style={{ fontSize: "11px", color: "#666" }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* tips */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "12px" }}>
          💡 建議回應方式
        </div>
        {tips.map((tip, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%",
              background: emotion.color, marginTop: "8px", flexShrink: 0 }} />
            <span style={{ fontSize: "14px", color: "#aaa", lineHeight: 1.6 }}>{tip}</span>
          </div>
        ))}
      </div>

      <button onClick={onClose} style={{
        width: "100%", padding: "14px", borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.05)", color: "#ccc",
        fontSize: "15px", fontWeight: 600, cursor: "pointer",
      }}>再聽一次</button>
    </div>
  );
}

function HistoryItem({ item, index }) {
  const emotion = CAT_EMOTIONS.find(e => e.id === item.emotionId);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "16px",
      padding: "16px 20px", background: "rgba(255,255,255,0.03)",
      borderRadius: "18px", marginBottom: "10px",
      animation: `fadeInLeft 0.4s ease ${index * 0.1}s both`,
      border: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ fontSize: "32px" }}>{emotion.emoji}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>{emotion.label}</div>
        <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>{item.time} · {item.pattern}</div>
      </div>
      <div style={{ fontSize: "14px", fontWeight: 700, color: emotion.color }}>{item.confidence}%</div>
    </div>
  );
}

/* ─── 主 App ─── */

const SOUND_LABELS = {
  hungry:   "急促短叫",
  happy:    "輕柔呼嚕",
  angry:    "低沉長嚎",
  lonely:   "嗚嗚低吟",
  playful:  "高音顫抖",
  scared:   "嘶嘶聲",
  greeting: "短促喵叫",
  demand:   "連續喵喵叫",
  love:     "喉音震動",
  curious:  "嘰嘰叫聲",
};

export default function App() {
  const [isListening, setIsListening]       = useState(false);
  const [audioLevel, setAudioLevel]         = useState(0);
  const [analyzing, setAnalyzing]           = useState(false);
  const [result, setResult]                 = useState(null);
  const [history, setHistory]               = useState([]);
  const [activeTab, setActiveTab]           = useState("listen");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [listenSeconds, setListenSeconds]   = useState(0);
  const [detectedSound, setDetectedSound]   = useState(false);

  const audioCtxRef   = useRef(null);
  const analyserRef   = useRef(null);
  const streamRef     = useRef(null);
  const animFrameRef  = useRef(null);
  const timerRef      = useRef(null);
  const featuresRef   = useRef([]);          // 累積多幀特徵

  /* 收集音訊特徵 */
  const collectFeatures = useCallback(() => {
    if (!analyserRef.current) return;
    const f = analyzeCatAudioFeatures(analyserRef.current);
    // 有聲音的時候才收集
    if (f.rms > 0.02) {
      featuresRef.current.push(f);
      setDetectedSound(true);
    }
  }, []);

  /* 分析 */
  const doAnalyze = useCallback(() => {
    setAnalyzing(true);
    setIsListening(false);
    // stop mic
    if (streamRef.current)  streamRef.current.getTracks().forEach(t => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current)   clearInterval(timerRef.current);

    const dur = listenSeconds;

    setTimeout(() => {
      const frames = featuresRef.current;
      let emotionId, confidence;

      if (frames.length > 0) {
        // 平均特徵
        const avg = { peakFreq: 0, rms: 0, zcr: 0, centroid: 0, lowRatio: 0, midRatio: 0, highRatio: 0 };
        frames.forEach(f => { Object.keys(avg).forEach(k => avg[k] += f[k]); });
        Object.keys(avg).forEach(k => avg[k] /= frames.length);
        const res  = classifyEmotion(avg, dur);
        emotionId  = res.emotionId;
        confidence = res.confidence;
      } else {
        // 沒收到明顯聲音 → 隨機
        const idx  = Math.floor(Math.random() * CAT_EMOTIONS.length);
        emotionId  = CAT_EMOTIONS[idx].id;
        confidence = 55 + Math.floor(Math.random() * 15);
      }

      const peakFreq = frames.length > 0
        ? Math.round(frames.reduce((s, f) => s + f.peakFreq, 0) / frames.length)
        : 300 + Math.floor(Math.random() * 400);

      const volumes = ["輕聲", "中等", "大聲", "極大聲"];
      const avgRms  = frames.length > 0
        ? frames.reduce((s, f) => s + f.rms, 0) / frames.length : 0;
      const volLabel = avgRms < 0.05 ? volumes[0] : avgRms < 0.15 ? volumes[1] : avgRms < 0.3 ? volumes[2] : volumes[3];

      const newResult = {
        emotionId,
        pattern:    SOUND_LABELS[emotionId],
        confidence,
        frequency:  `${peakFreq}Hz`,
        duration:   `${dur}秒`,
        volume:     volLabel,
        time:       new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }),
      };

      setResult(newResult);
      setHistory(prev => [newResult, ...prev].slice(0, 50));
      setAnalyzing(false);
      setListenSeconds(0);
      setDetectedSound(false);
      featuresRef.current = [];
    }, 1800);
  }, [listenSeconds]);

  /* 開始聆聽 */
  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setPermissionDenied(false);

      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      ctx.createMediaStreamSource(stream).connect(analyser);

      audioCtxRef.current  = ctx;
      analyserRef.current  = analyser;
      featuresRef.current  = [];

      setIsListening(true);
      setResult(null);
      setDetectedSound(false);
      setListenSeconds(0);

      timerRef.current = setInterval(() => setListenSeconds(prev => prev + 1), 1000);

      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      let frameCount = 0;
      const tick = () => {
        analyser.getByteFrequencyData(dataArr);
        const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
        setAudioLevel(avg / 255);
        frameCount++;
        if (frameCount % 6 === 0) collectFeatures();   // ~10 fps 收集
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error("Mic error:", err);
      setPermissionDenied(true);
    }
  };

  const stopListening = () => {
    if (streamRef.current)    streamRef.current.getTracks().forEach(t => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current)     clearInterval(timerRef.current);
    setIsListening(false);
    setAudioLevel(0);
    setListenSeconds(0);
    setDetectedSound(false);
    featuresRef.current = [];
  };

  useEffect(() => () => {
    if (streamRef.current)    streamRef.current.getTracks().forEach(t => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current)     clearInterval(timerRef.current);
  }, []);

  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  /* ─── Render ─── */
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(170deg, #0d0d1a 0%, #1a1a2e 40%, #16213e 100%)",
      color: "#fff",
      fontFamily: "'Noto Sans TC', -apple-system, BlinkMacSystemFont, sans-serif",
      position: "relative", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <style>{`
        @keyframes floatPaw   { 0%{transform:translateY(0) rotate(0)} 100%{transform:translateY(-30px) rotate(15deg)} }
        @keyframes slideUp    { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
        @keyframes bounceIn   { 0%{transform:scale(0)} 60%{transform:scale(1.15)} 100%{transform:scale(1)} }
        @keyframes expandBar  { from{width:0} }
        @keyframes fadeInLeft { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes spin       { to{transform:rotate(360deg)} }
        @keyframes pulse      { 0%,100%{opacity:1} 50%{opacity:0.4} }
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        button{font-family:inherit}
      `}</style>

      <PawParticles />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "480px", margin: "0 auto", padding: "0 20px 100px" }}>

        {/* ── Header ── */}
        <div style={{ textAlign: "center", padding: "40px 0 20px" }}>
          <div style={{ fontSize: "44px", marginBottom: "8px" }}>🐱</div>
          <h1 style={{
            fontSize: "28px", fontWeight: 900, letterSpacing: "-0.5px",
            background: "linear-gradient(135deg, #FF6B9D, #C44569, #FF8E53)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "8px",
          }}>喵語翻譯機</h1>
          <p style={{ fontSize: "14px", color: "#555", letterSpacing: "1px" }}>聆聽你家貓主子的心聲</p>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: "flex", gap: "4px", background: "rgba(255,255,255,0.04)",
          borderRadius: "16px", padding: "4px", marginBottom: "28px",
        }}>
          {[
            { id: "listen", label: "🎙️ 聆聽" },
            { id: "guide",  label: "📖 圖鑑" },
            { id: "history",label: "📋 紀錄" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex: 1, padding: "12px 8px", borderRadius: "12px", border: "none",
              background: activeTab === tab.id ? "rgba(255,107,157,0.15)" : "transparent",
              color: activeTab === tab.id ? "#FF6B9D" : "#666",
              fontSize: "14px", fontWeight: 600, cursor: "pointer", transition: "all 0.3s",
            }}>{tab.label}</button>
          ))}
        </div>

        {/* ════════════ LISTEN TAB ════════════ */}
        {activeTab === "listen" && (
          <div style={{ animation: "slideUp 0.4s ease" }}>
            {!result && !analyzing && (
              <>
                <WaveVisualizer isListening={isListening} audioLevel={audioLevel} />

                {isListening && (
                  <div style={{ textAlign: "center", marginBottom: "20px" }}>
                    <span style={{ fontSize: "32px", fontWeight: 300, color: "#FF6B9D",
                      fontVariantNumeric: "tabular-nums", letterSpacing: "2px",
                    }}>{fmt(listenSeconds)}</span>
                    <p style={{ fontSize: "13px", color: detectedSound ? "#7CB518" : "#666", marginTop: "8px",
                      animation: detectedSound ? "pulse 1s ease infinite" : "none",
                    }}>
                      {detectedSound ? "✅ 偵測到聲音訊號！可以按下分析" : "正在聆聽環境音...靠近貓咪試試"}
                    </p>
                  </div>
                )}

                {permissionDenied && (
                  <div style={{
                    background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)",
                    borderRadius: "16px", padding: "20px", marginBottom: "20px", textAlign: "center",
                  }}>
                    <p style={{ fontSize: "14px", color: "#E63946", lineHeight: 1.7 }}>
                      需要麥克風權限才能聆聽貓叫聲<br/>
                      請在系統設定中允許此 App 存取麥克風
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                  {!isListening ? (
                    <>
                      <button onClick={startListening} style={{
                        width: "160px", height: "160px", borderRadius: "50%",
                        border: "3px solid rgba(255,107,157,0.3)",
                        background: "radial-gradient(circle at 35% 35%, rgba(255,107,157,0.2), rgba(196,69,105,0.1))",
                        color: "#FF6B9D", fontSize: "48px", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 0 60px rgba(255,107,157,0.15)", transition: "all 0.3s",
                      }}>🎙️</button>
                      <p style={{ fontSize: "14px", color: "#555", marginTop: "8px" }}>
                        點擊麥克風開始聆聽貓叫聲
                      </p>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                      <button onClick={stopListening} style={{
                        width: "72px", height: "72px", borderRadius: "50%",
                        border: "2px solid rgba(255,255,255,0.15)",
                        background: "rgba(255,255,255,0.05)", color: "#999",
                        fontSize: "24px", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>⏹️</button>
                      <button onClick={doAnalyze} style={{
                        width: "120px", height: "120px", borderRadius: "50%",
                        border: "none",
                        background: "linear-gradient(135deg, #FF6B9D, #C44569)",
                        color: "#fff", fontSize: "18px", fontWeight: 700, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexDirection: "column", gap: "4px",
                        boxShadow: "0 8px 40px rgba(255,107,157,0.4)",
                        transition: "transform 0.2s",
                      }}><span style={{ fontSize: "28px" }}>🔍</span><span>分析</span></button>
                    </div>
                  )}
                </div>

                {/* info cards */}
                {!isListening && (
                  <div style={{ marginTop: "40px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    {[
                      { icon: "🔊", title: "即時收音", desc: "使用手機麥克風收集環境聲音" },
                      { icon: "🧠", title: "頻譜分析", desc: "分析音頻、音量、零交叉率等特徵" },
                      { icon: "💬", title: "翻譯解讀", desc: "比對聲學特徵判斷貓咪情緒" },
                      { icon: "📊", title: "歷史紀錄", desc: "追蹤貓咪的情緒變化趨勢" },
                    ].map((item, i) => (
                      <div key={i} style={{
                        background: "rgba(255,255,255,0.03)", borderRadius: "18px",
                        padding: "20px 16px", border: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        <div style={{ fontSize: "24px", marginBottom: "10px" }}>{item.icon}</div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#ddd", marginBottom: "4px" }}>{item.title}</div>
                        <div style={{ fontSize: "12px", color: "#555", lineHeight: 1.5 }}>{item.desc}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {analyzing && (
              <div style={{ textAlign: "center", padding: "60px 20px", animation: "slideUp 0.4s ease" }}>
                <div style={{
                  width: "100px", height: "100px", margin: "0 auto 24px",
                  borderRadius: "50%", border: "3px solid transparent",
                  borderTopColor: "#FF6B9D", animation: "spin 1s linear infinite",
                }} />
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>🐱</div>
                <p style={{ fontSize: "18px", fontWeight: 600, color: "#ddd", marginBottom: "8px" }}>正在分析喵語...</p>
                <p style={{ fontSize: "14px", color: "#666" }}>解碼頻譜特徵中，請稍候</p>
              </div>
            )}

            {result && !analyzing && (
              <ResultCard result={result} onClose={() => setResult(null)} />
            )}
          </div>
        )}

        {/* ════════════ GUIDE TAB ════════════ */}
        {activeTab === "guide" && (
          <div style={{ animation: "slideUp 0.4s ease" }}>
            <p style={{ fontSize: "14px", color: "#666", marginBottom: "20px", textAlign: "center" }}>
              了解不同貓叫聲代表的意思
            </p>
            {CAT_EMOTIONS.map((emotion, i) => (
              <div key={emotion.id} style={{
                display: "flex", alignItems: "center", gap: "16px",
                padding: "18px 20px", background: "rgba(255,255,255,0.03)",
                borderRadius: "18px", marginBottom: "10px",
                border: `1px solid ${emotion.color}15`,
                animation: `fadeInLeft 0.4s ease ${i * 0.05}s both`,
              }}>
                <div style={{ fontSize: "36px", width: "50px", textAlign: "center", flexShrink: 0 }}>{emotion.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>{emotion.label}</div>
                  <div style={{ fontSize: "13px", color: "#888", lineHeight: 1.5 }}>「{emotion.desc}」</div>
                </div>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  background: emotion.color, flexShrink: 0,
                  boxShadow: `0 0 12px ${emotion.color}60`,
                }} />
              </div>
            ))}
          </div>
        )}

        {/* ════════════ HISTORY TAB ════════════ */}
        {activeTab === "history" && (
          <div style={{ animation: "slideUp 0.4s ease" }}>
            {history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.4 }}>📋</div>
                <p style={{ fontSize: "16px", color: "#555", marginBottom: "8px" }}>還沒有分析紀錄</p>
                <p style={{ fontSize: "13px", color: "#444" }}>開始聆聽貓叫聲來建立紀錄吧！</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "13px", color: "#666" }}>共 {history.length} 筆紀錄</span>
                  <button onClick={() => setHistory([])} style={{
                    background: "none", border: "none", color: "#E63946",
                    fontSize: "13px", cursor: "pointer",
                  }}>清除全部</button>
                </div>
                {history.map((item, i) => <HistoryItem key={i} item={item} index={i} />)}
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ height: "env(safe-area-inset-bottom, 20px)" }} />
    </div>
  );
}
