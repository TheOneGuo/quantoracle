/**
 * @file BrokerVideoUpload.jsx
 * @description 实盘视频上传与OCR识别组件
 * 引导用户完成：获取挑战码 → 录制视频 → 上传 → 查看识别结果
 * 支持同花顺和东方财富两款券商App的持仓截图/视频识别。
 */

import React, { useState, useEffect, useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// 样式常量
// ──────────────────────────────────────────────────────────────────────────────
const styles = {
  container: {
    padding: '20px',
    maxWidth: '800px',
    margin: '0 auto',
    fontFamily: 'sans-serif'
  },
  stepBar: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '30px',
    position: 'relative'
  },
  stepItem: (active, done) => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 5px',
    borderBottom: `3px solid ${done ? '#52c41a' : active ? '#1890ff' : '#e8e8e8'}`,
    color: done ? '#52c41a' : active ? '#1890ff' : '#999',
    fontWeight: active || done ? 'bold' : 'normal',
    fontSize: '13px',
    cursor: 'default'
  }),
  card: {
    background: '#fafafa',
    border: '1px solid #e8e8e8',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '16px'
  },
  challengeCode: {
    fontSize: '48px',
    fontWeight: 'bold',
    letterSpacing: '12px',
    textAlign: 'center',
    color: '#1890ff',
    background: '#e6f7ff',
    borderRadius: '8px',
    padding: '20px',
    margin: '16px 0',
    fontFamily: 'monospace'
  },
  countdown: (urgent) => ({
    textAlign: 'center',
    fontSize: '14px',
    color: urgent ? '#ff4d4f' : '#666',
    marginBottom: '12px'
  }),
  btn: (type = 'primary') => ({
    padding: '8px 20px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '14px',
    background: type === 'primary' ? '#1890ff' : type === 'success' ? '#52c41a' : '#f0f0f0',
    color: type === 'default' ? '#333' : '#fff',
    marginRight: '8px',
    transition: 'opacity 0.2s'
  }),
  uploadArea: {
    border: '2px dashed #d9d9d9',
    borderRadius: '8px',
    padding: '40px',
    textAlign: 'center',
    cursor: 'pointer',
    background: '#fafafa',
    marginBottom: '16px'
  },
  progress: {
    height: '8px',
    background: '#e8e8e8',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px'
  },
  progressBar: (pct) => ({
    height: '100%',
    width: `${pct}%`,
    background: pct === 100 ? '#52c41a' : '#1890ff',
    borderRadius: '4px',
    transition: 'width 0.3s'
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  th: {
    background: '#f5f5f5',
    padding: '8px 12px',
    textAlign: 'left',
    borderBottom: '2px solid #e8e8e8',
    fontWeight: 'bold'
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #f0f0f0'
  },
  tag: (type) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '12px',
    background: type === 'success' ? '#f6ffed' : type === 'error' ? '#fff2f0' : '#fff7e6',
    color: type === 'success' ? '#52c41a' : type === 'error' ? '#ff4d4f' : '#fa8c16',
    border: `1px solid ${type === 'success' ? '#b7eb8f' : type === 'error' ? '#ffa39e' : '#ffd591'}`
  }),
  alert: (type) => ({
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '12px',
    background: type === 'success' ? '#f6ffed' : type === 'error' ? '#fff2f0' : '#e6f7ff',
    border: `1px solid ${type === 'success' ? '#b7eb8f' : type === 'error' ? '#ffa39e' : '#91d5ff'}`,
    color: type === 'success' ? '#389e0d' : type === 'error' ? '#cf1322' : '#0050b3'
  })
};

// ──────────────────────────────────────────────────────────────────────────────
// 主组件
// ──────────────────────────────────────────────────────────────────────────────
export default function BrokerVideoUpload({ token }) {
  // 步骤：1=获取挑战码, 2=录制视频, 3=上传, 4=识别结果
  const [step, setStep] = useState(1);

  // 挑战码相关状态
  const [challengeCode, setChallengeCode] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [countdown, setCountdown] = useState(600); // 秒
  const countdownRef = useRef(null);

  // 上传相关状态
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');

  // 识别结果状态
  const [result, setResult] = useState(null);
  // 用户可编辑的持仓数据（纠错功能）
  const [editedHoldings, setEditedHoldings] = useState([]);

  const fileInputRef = useRef(null);

  // ── 倒计时逻辑 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        // 挑战码过期，重置
        setChallengeCode('');
        setExpiresAt(null);
        setStep(1);
        clearInterval(countdownRef.current);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(countdownRef.current);
  }, [expiresAt]);

  // ── 获取挑战码 ──────────────────────────────────────────────────────────
  const fetchChallengeCode = async () => {
    try {
      const resp = await fetch('/api/broker/challenge', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await resp.json();
      if (data.success) {
        setChallengeCode(data.challenge_code);
        setExpiresAt(data.expires_at);
        setStep(2);
      } else {
        alert('获取挑战码失败: ' + (data.error || '未知错误'));
      }
    } catch (err) {
      alert('网络错误: ' + err.message);
    }
  };

  // ── 文件选择处理 ────────────────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验文件类型
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/avi', 'image/jpeg', 'image/jpg', 'image/png'];
    const ext = file.name.toLowerCase().split('.').pop();
    const allowedExts = ['mp4', 'mov', 'avi', 'jpg', 'jpeg', 'png'];

    if (!allowedExts.includes(ext)) {
      alert('仅支持 mp4/mov/avi 视频格式，或 jpg/png 截图格式');
      return;
    }

    // 校验文件大小（50MB）
    if (file.size > 50 * 1024 * 1024) {
      alert('文件大小不能超过 50MB');
      return;
    }

    setSelectedFile(file);
    setUploadError('');
  };

  // ── 上传并识别 ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadError('请先选择视频或截图文件');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('video', selectedFile);
      if (challengeCode) {
        formData.append('challenge_code', challengeCode);
      }

      // 使用 XMLHttpRequest 以便显示上传进度
      const uploadResult = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 80)); // 上传占80%进度
          }
        };

        xhr.onload = () => {
          setUploadProgress(100);
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).error || '上传失败'));
            } catch {
              reject(new Error(`服务器错误 ${xhr.status}`));
            }
          }
        };

        xhr.onerror = () => reject(new Error('网络错误'));

        xhr.open('POST', '/api/broker/upload-video');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });

      if (uploadResult.success) {
        setResult(uploadResult);
        setEditedHoldings(uploadResult.holdings || []);
        setStep(4);
      } else {
        setUploadError(uploadResult.error || '识别失败');
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ── 持仓数据编辑 ────────────────────────────────────────────────────────
  const updateHolding = (index, field, value) => {
    const updated = [...editedHoldings];
    updated[index] = { ...updated[index], [field]: value };
    setEditedHoldings(updated);
  };

  // ── 格式化倒计时 ────────────────────────────────────────────────────────
  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ── 渲染步骤条 ──────────────────────────────────────────────────────────
  const renderStepBar = () => (
    <div style={styles.stepBar}>
      {['获取挑战码', '录制视频', '上传文件', '识别结果'].map((label, i) => (
        <div key={i} style={styles.stepItem(step === i + 1, step > i + 1)}>
          {step > i + 1 ? '✓ ' : `${i + 1}. `}{label}
        </div>
      ))}
    </div>
  );

  // ── Step 1: 获取挑战码 ──────────────────────────────────────────────────
  const renderStep1 = () => (
    <div style={styles.card}>
      <h3>第一步：获取挑战码</h3>
      <p style={{ color: '#666' }}>
        为防止伪造，请先获取一个4位挑战码，在录制持仓视频时将该码展示在画面中（用计算器或备忘录显示均可）。
      </p>
      <button style={styles.btn('primary')} onClick={fetchChallengeCode}>
        🎲 获取挑战码
      </button>
      <p style={{ color: '#999', fontSize: '12px', marginTop: '12px' }}>
        ⚠️ 挑战码有效期10分钟，过期后需重新获取
      </p>
    </div>
  );

  // ── Step 2: 录制视频引导 ────────────────────────────────────────────────
  const renderStep2 = () => (
    <div style={styles.card}>
      <h3>第二步：录制持仓视频</h3>

      {/* 挑战码展示 */}
      <div style={styles.challengeCode}>{challengeCode}</div>
      <div style={styles.countdown(countdown < 120)}>
        ⏱ 挑战码剩余有效期：<strong>{formatCountdown(countdown)}</strong>
        {countdown < 120 && ' （即将过期，请尽快录制）'}
      </div>

      {/* 录制指引 */}
      <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '6px', padding: '16px', marginBottom: '16px' }}>
        <strong>📹 录制要求：</strong>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', color: '#666', fontSize: '13px' }}>
          <li>打开同花顺或东方财富App，进入持仓页面</li>
          <li>录制时长 <strong>至少5秒</strong>（防止截图伪造）</li>
          <li>将上方挑战码 <strong>{challengeCode}</strong> 展示在视频画面中（如用计算器打出该数字）</li>
          <li>确保持仓信息清晰可见（股票名称、代码、数量、价格等）</li>
          <li>也可直接上传持仓截图（jpg/png），但挑战码验证可能无法完成</li>
        </ul>
      </div>

      <button style={styles.btn('primary')} onClick={() => setStep(3)}>
        📁 我已录制完毕，去上传 →
      </button>
      <button style={styles.btn('default')} onClick={() => { setChallengeCode(''); setExpiresAt(null); setStep(1); }}>
        ↩ 重新获取挑战码
      </button>
    </div>
  );

  // ── Step 3: 上传文件 ────────────────────────────────────────────────────
  const renderStep3 = () => (
    <div style={styles.card}>
      <h3>第三步：上传视频/截图</h3>

      {challengeCode && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: '#666' }}>
          当前挑战码：<strong style={{ color: '#1890ff', fontSize: '18px', fontFamily: 'monospace' }}>{challengeCode}</strong>
          {'  '}剩余：{formatCountdown(countdown)}
        </div>
      )}

      {/* 上传区域 */}
      <div
        style={styles.uploadArea}
        onClick={() => fileInputRef.current?.click()}
      >
        {selectedFile ? (
          <div>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📄</div>
            <div style={{ fontWeight: 'bold' }}>{selectedFile.name}</div>
            <div style={{ color: '#999', fontSize: '12px' }}>
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </div>
            <div style={{ color: '#1890ff', marginTop: '8px', fontSize: '13px' }}>点击重新选择</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📤</div>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>点击选择视频或截图</div>
            <div style={{ color: '#999', fontSize: '12px' }}>支持 mp4/mov/avi 视频，或 jpg/png 截图，最大 50MB</div>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/avi,.avi,.mp4,.mov,image/jpeg,image/png,.jpg,.jpeg,.png"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* 进度条 */}
      {uploading && (
        <div style={{ marginBottom: '12px' }}>
          <div style={styles.progress}>
            <div style={styles.progressBar(uploadProgress)} />
          </div>
          <div style={{ textAlign: 'center', fontSize: '13px', color: '#666' }}>
            {uploadProgress < 80 ? `上传中... ${uploadProgress}%` : '识别中，请稍候...'}
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {uploadError && (
        <div style={styles.alert('error')}>⚠️ {uploadError}</div>
      )}

      <div>
        <button
          style={styles.btn('primary')}
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
        >
          {uploading ? '⏳ 识别中...' : '🚀 开始上传识别'}
        </button>
        <button style={styles.btn('default')} onClick={() => setStep(2)} disabled={uploading}>
          ← 返回
        </button>
      </div>
    </div>
  );

  // ── Step 4: 识别结果 ────────────────────────────────────────────────────
  const renderStep4 = () => {
    if (!result) return null;

    const appTypeLabel = result.app_type === 'tonghuashun' ? '同花顺 🟠' :
                         result.app_type === 'eastmoney' ? '东方财富 🟢' : '未知App';

    return (
      <div>
        {/* 识别概况 */}
        <div style={styles.card}>
          <h3>第四步：识别结果</h3>

          {/* 验证状态 */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <span style={styles.tag(result.app_type !== 'unknown' ? 'success' : 'warning')}>
              App: {appTypeLabel}
            </span>
            <span style={styles.tag(result.challenge_verified ? 'success' : 'warning')}>
              挑战码: {result.challenge_verified ? '✓ 验证通过' : '⚠ 未验证'}
            </span>
            <span style={styles.tag(result.time_verified ? 'success' : 'warning')}>
              时间戳: {result.time_verified ? '✓ 验证通过' : '⚠ 未验证'}
            </span>
            <span style={styles.tag(result.is_static_detected ? 'error' : 'success')}>
              真实性: {result.is_static_detected ? '⚠ 疑似静态图' : '✓ 通过'}
            </span>
            <span style={styles.tag(result.confidence_score >= 0.6 ? 'success' : 'warning')}>
              置信度: {((result.confidence_score || 0) * 100).toFixed(0)}%
            </span>
          </div>

          {/* 警告信息 */}
          {result.warnings?.map((w, i) => (
            <div key={i} style={styles.alert('warning')}>⚠️ {w}</div>
          ))}

          {result.holdings_saved && (
            <div style={styles.alert('success')}>✅ 持仓数据已成功入库，系统将重新计算策略信用评级</div>
          )}
        </div>

        {/* 持仓数据表格（可编辑） */}
        <div style={styles.card}>
          <h4 style={{ marginTop: 0 }}>
            识别到的持仓数据（共 {editedHoldings.length} 只）
            <span style={{ fontWeight: 'normal', fontSize: '12px', color: '#999', marginLeft: '8px' }}>
              可直接修改数据后确认提交
            </span>
          </h4>

          {editedHoldings.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
              未识别到持仓数据，请确认视频清晰度和App类型
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['股票代码', '股票名称', '持有数量', '均价(元)', '最新价(元)', '盈亏金额(元)', '盈亏比例(%)', '市值(元)'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editedHoldings.map((holding, idx) => (
                    <tr key={idx}>
                      {['stock_code', 'stock_name', 'quantity', 'avg_cost', 'current_price', 'profit_amount', 'profit_pct', 'market_value'].map(field => (
                        <td key={field} style={styles.td}>
                          <input
                            style={{ border: '1px solid #d9d9d9', borderRadius: '4px', padding: '2px 6px', width: '90px', fontSize: '13px' }}
                            value={holding[field] ?? ''}
                            onChange={e => updateHolding(idx, field, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div>
          <button style={styles.btn('primary')} onClick={() => {
            // 重新开始
            setStep(1);
            setChallengeCode('');
            setExpiresAt(null);
            setSelectedFile(null);
            setResult(null);
            setEditedHoldings([]);
            setUploadProgress(0);
          }}>
            🔄 重新上传
          </button>
        </div>
      </div>
    );
  };

  // ── 主渲染 ──────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <h2 style={{ marginBottom: '8px' }}>📹 实盘验证 - 视频OCR持仓识别</h2>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '13px' }}>
        通过录制券商App持仓视频，系统自动识别您的实盘持仓数据，用于策略信用评级。
        支持同花顺、东方财富。
      </p>

      {renderStepBar()}

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </div>
  );
}
