/**
 * DefectAI — Main Application Orchestrator
 * Ties together camera, detector, inspector, training, and storage
 */
(function () {
    'use strict';

    // ---- DOM References ----
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingStatus = document.getElementById('loading-status');
    const loadingProgress = document.getElementById('loading-progress');
    const appEl = document.getElementById('app');
    const modelStatusEl = document.getElementById('model-status');
    const startCameraBtn = document.getElementById('btn-start-camera');
    const statusBar = document.getElementById('status-bar');
    const statusLabel = document.getElementById('status-label');
    const statusSublabel = document.getElementById('status-sublabel');
    const iconOk = document.getElementById('icon-ok');
    const iconDefect = document.getElementById('icon-defect');
    const iconIdle = document.getElementById('icon-idle');
    const confidenceBar = document.getElementById('confidence-bar');
    const confidenceValue = document.getElementById('confidence-value');
    const detectionTags = document.getElementById('detection-tags');
    const toggleDetection = document.getElementById('toggle-detection');
    const toggleAutosave = document.getElementById('toggle-autosave');
    const toggleSound = document.getElementById('toggle-sound');
    const resetStatsBtn = document.getElementById('btn-reset-stats');

    // Stats
    const statTotal = document.getElementById('stat-total');
    const statOk = document.getElementById('stat-ok');
    const statDefective = document.getElementById('stat-defective');
    const statDefectRate = document.getElementById('stat-defect-rate');

    // Panels
    const trainingPanel = document.getElementById('training-panel');
    const historyPanel = document.getElementById('history-panel');
    const panelBackdrop = document.getElementById('panel-backdrop');

    // State
    let detectionActive = true;
    let autoSave = true;
    let soundEnabled = false;
    let lastInferenceTime = 0;
    const INFERENCE_INTERVAL = 150; // ~7 FPS inference
    let animFrameId = null;

    // Audio context for alert sounds
    let audioCtx = null;

    // ---- Initialization ----
    async function init() {
        try {
            // 1. Storage
            updateLoading(5, 'Initializing storage...');
            await window.storageManager.init();

            // 2. AI Detector
            await window.defectDetector.init((progress, msg) => {
                updateLoading(progress, msg);
            });

            // 3. Inspector state
            await window.inspector.init();
            updateStats();

            // 4. Training UI
            window.trainingManager.init();

            // 5. Wire up UI events
            setupEventListeners();

            // 6. Load history
            await loadHistory();

            // 7. Show app
            updateLoading(100, 'Ready!');
            setTimeout(() => {
                loadingOverlay.classList.add('fade-out');
                appEl.classList.remove('hidden');
                setModelStatus('ready', 'Model Ready');
            }, 500);

            // 8. Auto-start camera
            setTimeout(async () => {
                const ok = await window.cameraManager.start();
                if (ok) {
                    startDetectionLoop();
                }
            }, 800);

        } catch (err) {
            console.error('Init error:', err);
            updateLoading(0, `Error: ${err.message}`);
            setModelStatus('error', 'Load Failed');
        }
    }

    function updateLoading(percent, message) {
        loadingProgress.style.width = percent + '%';
        loadingStatus.textContent = message;
    }

    function setModelStatus(state, text) {
        const dot = modelStatusEl.querySelector('.status-dot');
        const label = modelStatusEl.querySelector('.status-label');
        dot.className = 'status-dot ' + state;
        label.textContent = text;
    }

    // ---- Event Listeners ----
    function setupEventListeners() {
        // Camera start
        startCameraBtn.addEventListener('click', async () => {
            const ok = await window.cameraManager.start();
            if (ok) startDetectionLoop();
        });

        // Toggle detection
        toggleDetection.addEventListener('change', (e) => {
            detectionActive = e.target.checked;
            if (!detectionActive) {
                setIdleStatus();
            }
        });

        // Toggle autosave
        toggleAutosave.addEventListener('change', (e) => { autoSave = e.target.checked; });

        // Toggle sound
        toggleSound.addEventListener('change', (e) => { soundEnabled = e.target.checked; });

        // Reset stats
        resetStatsBtn.addEventListener('click', async () => {
            if (confirm('Reset all inspection statistics?')) {
                await window.inspector.resetStats();
                updateStats();
            }
        });

        // Training panel
        document.getElementById('btn-toggle-training').addEventListener('click', () => {
            togglePanel('training');
        });
        document.getElementById('btn-close-training').addEventListener('click', () => closePanel());

        // History panel
        document.getElementById('btn-toggle-history').addEventListener('click', () => {
            loadHistory();
            togglePanel('history');
        });
        document.getElementById('btn-close-history').addEventListener('click', () => closePanel());

        // Backdrop closes panel
        panelBackdrop.addEventListener('click', () => closePanel());

        // Export history
        document.getElementById('btn-export-history').addEventListener('click', async () => {
            const csv = await window.storageManager.exportInspectionsCSV();
            if (!csv) return;
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `defect-inspections-${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // Clear history
        document.getElementById('btn-clear-history').addEventListener('click', async () => {
            if (confirm('Clear all inspection history?')) {
                await window.storageManager.clearInspections();
                await window.inspector.resetStats();
                updateStats();
                loadHistory();
            }
        });
    }

    // ---- Panel Management ----
    function togglePanel(name) {
        const panel = name === 'training' ? trainingPanel : historyPanel;
        const otherPanel = name === 'training' ? historyPanel : trainingPanel;

        otherPanel.classList.remove('open');

        if (panel.classList.contains('open')) {
            closePanel();
        } else {
            panel.classList.add('open');
            panelBackdrop.classList.add('visible');
        }
    }

    function closePanel() {
        trainingPanel.classList.remove('open');
        historyPanel.classList.remove('open');
        panelBackdrop.classList.remove('visible');
    }

    // ---- Detection Loop ----
    function startDetectionLoop() {
        if (animFrameId) cancelAnimationFrame(animFrameId);

        function loop(timestamp) {
            animFrameId = requestAnimationFrame(loop);

            if (!detectionActive || !window.cameraManager.isActive) return;

            // Throttle inference
            if (timestamp - lastInferenceTime < INFERENCE_INTERVAL) return;
            lastInferenceTime = timestamp;

            processFrame();
        }

        animFrameId = requestAnimationFrame(loop);
    }

    async function processFrame() {
        const cam = window.cameraManager;
        const detector = window.defectDetector;
        const insp = window.inspector;

        // 1. Detect product presence
        const presence = cam.detectProductPresence();

        // 2. Run AI prediction if model is trained
        let prediction = null;
        if (detector.isTrainingReady()) {
            const frame = cam.captureFrame();
            if (frame) {
                prediction = await detector.predict(frame);
            }
        }

        // 3. Process through inspector
        const result = insp.processFrame(prediction, presence);

        // 4. Update UI
        if (result.currentResult) {
            updateStatusUI(result.currentResult);
            updateDetectionTags(result.currentResult, prediction);
            cam.drawOverlay(
                result.currentResult.status,
                result.currentResult.defectType,
                result.currentResult.confidence
            );
        } else if (result.stateChanged && insp.state === 'idle') {
            setIdleStatus();
            cam.drawOverlay(null);
        }

        // 5. Inspection complete — save
        if (result.inspectionComplete && result.finalResult && autoSave) {
            const thumbnail = cam.captureThumbnail();
            await insp.saveInspection(result.finalResult, thumbnail);
            updateStats();

            // Sound alert for defects
            if (result.finalResult.isDefective && soundEnabled) {
                playAlertSound();
            }
        }

        // If no training data yet, show a helpful idle state
        if (!detector.isTrainingReady()) {
            statusLabel.textContent = 'READY';
            statusSublabel.textContent = 'Add training examples to start detection';
            statusBar.className = 'status-bar';
            showIcon('idle');
            confidenceValue.textContent = '—';
            confidenceBar.style.width = '0%';
            cam.drawOverlay(null);
        }
    }

    // ---- UI Updates ----
    function updateStatusUI(result) {
        if (!result) return;

        statusBar.className = 'status-bar ' + result.status;

        if (result.isDefective) {
            statusLabel.textContent = 'DEFECTIVE';
            statusSublabel.textContent = formatLabel(result.defectType);
            showIcon('defect');
        } else {
            statusLabel.textContent = 'OK';
            statusSublabel.textContent = 'No defects detected';
            showIcon('ok');
        }

        const pct = (result.confidence * 100).toFixed(1);
        confidenceBar.style.width = pct + '%';
        confidenceValue.textContent = pct + '%';
    }

    function updateDetectionTags(result, rawPrediction) {
        detectionTags.innerHTML = '';

        if (!rawPrediction || !rawPrediction.confidences) return;

        // Sort by confidence
        const entries = Object.entries(rawPrediction.confidences)
            .sort((a, b) => b[1] - a[1]);

        for (const [label, conf] of entries) {
            if (conf < 0.01) continue;
            const tag = document.createElement('div');
            tag.className = `detection-tag tag-${label}`;
            tag.innerHTML = `
                <span class="tag-dot"></span>
                <span>${formatLabel(label)}: ${(conf * 100).toFixed(0)}%</span>
            `;
            detectionTags.appendChild(tag);
        }
    }

    function setIdleStatus() {
        statusBar.className = 'status-bar';
        statusLabel.textContent = 'IDLE';
        statusSublabel.textContent = 'Waiting for product...';
        showIcon('idle');
        confidenceValue.textContent = '—';
        confidenceBar.style.width = '0%';
        detectionTags.innerHTML = '';
    }

    function showIcon(type) {
        iconOk.classList.toggle('hidden', type !== 'ok');
        iconDefect.classList.toggle('hidden', type !== 'defect');
        iconIdle.classList.toggle('hidden', type !== 'idle');
    }

    function updateStats() {
        const s = window.inspector.stats;
        statTotal.textContent = s.total;
        statOk.textContent = s.ok;
        statDefective.textContent = s.defective;
        statDefectRate.textContent = s.defectRate + '%';

        // Update category breakdown
        const categories = window.defectDetector.categories.filter(c => c !== 'ok');
        for (const cat of categories) {
            const el = document.getElementById(`cat-${cat}`);
            if (el) el.textContent = s.categories[cat] || 0;
        }
    }

    // ---- History ----
    async function loadHistory() {
        const list = document.getElementById('history-list');
        const empty = document.getElementById('history-empty');

        const inspections = await window.storageManager.getInspections(50);

        if (inspections.length === 0) {
            empty.style.display = '';
            return;
        }

        empty.style.display = 'none';
        // Clear existing items (keep the empty placeholder)
        const items = list.querySelectorAll('.history-item');
        items.forEach(i => i.remove());

        for (const insp of inspections) {
            const item = document.createElement('div');
            item.className = 'history-item';

            const thumbSrc = insp.thumbnail || '';
            const statusClass = insp.status === 'ok' ? 'ok' : 'defective';
            const statusText = insp.status === 'ok' ? 'OK' : 'DEFECTIVE';
            const detail = insp.defectType
                ? `${formatLabel(insp.defectType)} — ${(insp.confidence * 100).toFixed(0)}%`
                : 'No defects';
            const time = formatTime(insp.timestamp);

            item.innerHTML = `
                ${thumbSrc ? `<img class="history-thumb" src="${thumbSrc}" alt="Inspection">` : '<div class="history-thumb"></div>'}
                <div class="history-info">
                    <div class="hi-status ${statusClass}">${statusText}</div>
                    <div class="hi-detail">${detail}</div>
                    <div class="hi-time">${time}</div>
                </div>
            `;
            list.appendChild(item);
        }
    }

    // ---- Audio ----
    function playAlertSound() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = 800;
            gain.gain.value = 0.15;
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
            osc.stop(audioCtx.currentTime + 0.3);
        } catch (e) { /* ignore audio errors */ }
    }

    // ---- Helpers ----
    function formatLabel(label) {
        if (!label) return '';
        return label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatTime(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ---- Boot ----
    document.addEventListener('DOMContentLoaded', init);

})();
